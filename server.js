import express, { response } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs'
import util from 'util'
import ModelConversation from './Model.js';


import appendTurnToConversation from './Controller.js';
import connectDB from './Utility.js';
dotenv.config();



await connectDB()

console.log('Type of Model:', typeof ModelConversation); 
console.log('Available keys:', Object.keys(ModelConversation || {}));

let conversationHistory = []
let conversation = {user : "" , ai : ""}
// const text = fs.readFileSync("questions.txt", "utf8");
const text = "Sports based"

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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



// --- WebSocket Connection Logic ---
wss.on('connection', async (ws) => {
    console.log('🟢 Client connected');

    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
    const model = "gemini-2.5-flash-native-audio-preview-12-2025";
    const config = {
    tools: [{ functionDeclarations: [controlThemes] }],
    responseModalities: [Modality.AUDIO], 
    // Enable User Speech-to-Text
  inputAudioTranscription: {
    enabled: true,
  },
  // Enable Model Speech-to-Text
  outputAudioTranscription: {
    enabled: true,
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
            text: `You are Cassandra, a supportive senior interviewer taking interview for assessing personality of candidate, ask questions using this content => ${text}, finally after the end of interview, give feedback. Greet the candidate first and tell about your name.`
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
                        console.log("AI said => " + text);
                        
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
            console.log("LOGGING FINAL USER TRANSCRIPT:", currentUserUtterance);
            
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
            await appendTurnToConversation("session_123", conversation.user, conversation.ai);
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

    ws.on('close', () => {
        console.log('🔴 Client disconnected');

        console.log("------------ CONVERSATION HISTORY -----------------") ;

        for(let conversation of conversationHistory)
        {
           console.log(`${conversation.role} said: ${conversation.response}`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});



function handleToolCall(session, toolCall) {
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

            return { type: 'change-theme', data: fc.args.theme };
        }
    }

    return toolResult;
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is listening on http://localhost:${PORT}`);
});