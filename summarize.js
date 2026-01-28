import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function summarizeConversation(history) {
  console.log("GEMINI api key => " + process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    // FIX: systemInstruction must follow this specific structure
    systemInstruction: {
      parts: [{
        text: "You are a professional assistant. Summarize the following interview conversation. Focus on key decisions, candidate technical skills, and overall sentiment. Use bullet points."
      }]
    }
  });

  const formattedHistory = history
    .map(msg => {
      const role = msg.role === 'user' ? 'Candidate' : 'Interviewer';
      // FIX: Use .text (or whatever your property name is) instead of .response
      return `${role}: ${msg.response || msg.content || ""}`;
    })
    .join('\n');

  const prompt = `Please provide a concise summary of this conversation:\n\n${formattedHistory}`;

  try {
    const result = await model.generateContent(prompt);
    // response.text() is an asynchronous method in some versions/scenarios, 
    // but usually calling it directly is fine if you've awaited result.
    return result.response.text();
  } catch (error) {
    console.error("Summarization failed:", error);
    return "Could not generate summary.";
  }
}

let history = [{role : 'user' , response : 'Hey there !!!'},
{role : 'ai' , response : 'hellow  there I am ready to take your interview !!!'},
{role : 'user' , response : 'I am ready to begin'}

]

export default summarizeConversation;