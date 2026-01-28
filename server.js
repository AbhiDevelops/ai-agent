import express, { response } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs'
import util from 'util'
import ModelConversation from './Model.js';


import {appendTurnToConversation, appendQuestionSequence} from './Controller.js';
import connectDB from './Utility.js';
import summarizeConversation from './summarize.js';
dotenv.config();



await connectDB()



let conversationHistory = []
let conversation = {user : "" , ai : ""}
const text = fs.readFileSync("questions.txt", "utf8");
// const text = "Sports based"

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let sessionId = "session_321"
if (!process.env.GEMINI_API_KEY) {
    console.error("🔴 ERROR: Missing GEMINI_API_KEY in .env file!");
    process.exit(1);
}

app.use(express.static('public'));


const controlThemes = {
    name: "change-theme",
    description: "Changing the background color of the application",
    parameters: {
        type: "OBJECT",
        properties: {
            theme: { type: "STRING", description: "light or dark" },
        },
        required: ["theme"]
    }
};

const questionSequence = {
    name : "question-number",
    description : "Tell question number in the format : number.0 for main question and number.follow_up number for follow up questions from main question, do not call this tool if question is not asked from the given document",
      parameters: {
        type: "OBJECT",
        properties: {
            sequence: { type: "STRING", description: "sequence in format like 1.0, 2.0, 3.0, etc for main question and 1.1, 1.3, etc for follow up questions" },
        },
        required: ["sequence"]
    }
}

const endInterview = {
  name: "end-interview",
  description: "Call this tool when the interview is fully completed.",
  parameters: {
    type: "OBJECT",
    properties: {},
    required: []
  }
};



// --- WebSocket Connection Logic ---
wss.on('connection', async (ws) => {
    console.log('🟢 Client connected');

    ws.isAlive = true ;
    
    ws.on('pong', () => {
    ws.isAlive = true;
    const latency = Date.now() - ws.pingSentAt;
    
    // If latency is high, notify the user they are unstable
    if (latency > 1000) { // 1 second threshold
      ws.send(JSON.stringify({ 
        type: 'connection-unstable', 
        payload: { latency } 
      }));
    }
  });


    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
    const model = "gemini-2.5-flash-native-audio-preview-12-2025";
    const config = {
        thinkingConfig: {
        thinkingBudget: -1,
       
      },
    
    tools: [{ functionDeclarations: [controlThemes,questionSequence,endInterview] }],
    responseModalities: [Modality.AUDIO], 
    // Enable User Speech-to-Text
  inputAudioTranscription: {
   
  },
  // Enable Model Speech-to-Text
  outputAudioTranscription: {
    
  },
   speechConfig: {
        voiceConfig: {
            prebuiltVoiceConfig: {
                voiceName: "Kore" // Choose: Kore, Puck, Charon, Fenrir, or Aoede
            }
        }
    },
    

    realtimeInputConfig: {
        automaticActivityDetection: {
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            prefixPaddingMs: 20,
            silenceDurationMs: 200
        }
    },
    systemInstruction: {
        parts: [{
            text: `You are Cassandra, a supportive senior interviewer taking interview for assessing personality of candidate, ask questions using this content => ${text}, do not speak the question number, finally after the end of interview, give feedback. Greet the candidate first and tell about your name. When the interview is fully completed, you MUST call the tool "end-interview".
This tool takes NO arguments.
You MUST call it exactly once.`
        }]
    }
};

    let currentUserUtterance = ""
    let session;
    try {
        session = await genAI.live.connect({
            model,
            config,
            callbacks: {
                onopen: () => console.log('Session opened'),
                onmessage: async (message) => {
                    let text = '';
                    let audioData = '';
                    // console.log("Received message => " + Object.keys(message));

                   

                    if (message.candidates && message.candidates[0] && message.candidates[0].content && message.candidates[0].content.parts && message.candidates[0].content.parts[0].text) {
                        text = message.candidates[0].content.parts[0].text;
                        
                    }

                    if (message.toolCall) {
                        let response = handleToolCall(session, message.toolCall);
                        console.log(`sending message to client => ${response.type}`);

                        ws.send(JSON.stringify(response));
                    }

                    if (message.data) {
                        audioData = message.data; // base64 PCM
                    }
                    if (message.serverContent && message.serverContent.interrupted) {
                        ws.send(JSON.stringify({ type: 'interrupted' }));
                    }
                    if (text) {
                        // console.log("AI said => " + text);
                        
                        // ws.send(JSON.stringify({ type: 'ai-response', text }));
                    }
                    if (audioData) {
                        ws.send(JSON.stringify({ type: 'ai-audio', data: audioData }));
                    }

                       let serverContent = message.serverContent ;
                         if (message.serverContent) {
        const { modelTurn, inputTranscription } = message.serverContent;

        // console.log(util.inspect(message.serverContent, { showHidden: false, depth: null, colors: true }))
   
   
        // STEP 1: Always update the buffer if a transcript is present
    if (inputTranscription?.text) {
        currentUserUtterance += inputTranscription.text;
        // Optional: Send partials to UI for real-time captions
        // console.log("User partially said => " + currentUserUtterance);
        
        ws.send(JSON.stringify({ type: 'user-partial', text : inputTranscription.text }));
    }

    // STEP 2: Handle the Turn Switch (Commit to History)
    if (modelTurn) {
        // This is the "End of User Turn" signal
        if (currentUserUtterance.trim() !== "") {
            // console.log("LOGGING FINAL USER TRANSCRIPT:", currentUserUtterance);
            
            conversationHistory.push({
                role: 'user', 
                response: currentUserUtterance 
            });

            conversation.user = currentUserUtterance

            // IMPORTANT: Clear buffer AFTER logging to prevent double-logging
            currentUserUtterance = ""; 
        }

            // Handle Model Text (AI response)
            const aiText = modelTurn.parts?.find(p => p.text)?.text;
            if (aiText) {
                // console.log("Gemini said:", aiText);
                conversationHistory.push({role : 'ai' , response : aiText})
                conversation.ai = aiText ;
                ws.send(JSON.stringify({type : 'ai-response' , text : aiText}))
            }
        }

        if(message.serverContent?.turnComplete)
        {
            if(conversation.ai !== "" && conversation.user !== "")
            await appendTurnToConversation("session_321", conversation.user, conversation.ai);
            conversation = {ai : "" , user : ""}
        }
    }


                },
                onerror: (e) => {
                    console.error('Error:', e);
                    ws.send(JSON.stringify({ type: 'error', data: e.message }));
                },
                onclose: (e) => console.log('Session closed:', e),
            },
        });
    } catch (error) {
        console.error('Error creating session:', error);
        ws.send(JSON.stringify({ type: 'error', data: error.message }));
        ws.close();
        return;
    }

    ws.on('message', (message) => {
        if (Buffer.isBuffer(message)) {
            const base64 = message.toString('base64');
            session.sendRealtimeInput({
                audio: {
                    data: base64,
                    mimeType: "audio/pcm;rate=16000"
                }
            });
        }
    });

    ws.on('close', async() => {
        console.log('🔴 Client disconnected');
           console.log("------------ CONVERSATION HISTORY -----------------") ;

        for(let conversation of conversationHistory)
        {
           console.log(`${conversation.role} said: ${conversation.response}`);
        }

        const summary =  await summarizeConversation(conversationHistory) ;
        console.log(`Conversation summary => ${summary}`);
        
       
     
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Check every 10 seconds if connections are still alive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.pingSentAt = Date.now(); // Mark the start time
    ws.ping();
  });
}, 10000); // Check every 5 seconds for a responsive UI


wss.on('close', () => {
  clearInterval(interval);
});

async function handleToolCall(session, toolCall) {
    const functionResponses = [];
    let toolResult = {};
    for (const fc of toolCall.functionCalls) {
        if (fc.name === "change-theme") {
            // 1. Execute your local logic
            console.log(`Setting theme to ${fc.args.theme}%`);
            const result = { status: "success", applied: fc.args };

            // 2. Format the response
            functionResponses.push({
                id: fc.id,
                name: fc.name,
                response: result
            });

            toolResult = { type: 'change-theme', data: fc.args.theme };
        }
        else if(fc.name === "question-number")
        {

             const result = { status: "successfully saved question sequence", applied: fc.args };
            // console.log("Question number ===> " + fc.args.sequence);

            await appendQuestionSequence(sessionId,fc.args.sequence)
            functionResponses.push({
                id: fc.id,
                name: fc.name,
                response: result
            });
        }
        else if(fc.name === "end-interview")
        {
          
            console.log("Ending the interview...");
             console.log("------------ CONVERSATION HISTORY -----------------") ;
            ws.close(1000, "Session ended");

         const result = { status: "successfully ended interivew", applied: fc.args };

            functionResponses.push({
                id: fc.id,
                name: fc.name,
                response: result
            });

       
            
        }
    }

    return toolResult;
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is listening on http://localhost:${PORT}`);
});