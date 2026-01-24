import mongoose from 'mongoose';
// 1. Define the Schema for a single turn
const turnSchema = new mongoose.Schema({
  userTranscript: String,
  modelResponse: String,
  timestamp: { type: Date, default: Date.now }
});

// 2. Define the Main Conversation Schema
const conversationSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  turns: [turnSchema], // This is your array of objects,
  questionsAsked : [String]
});

const ModelConversation = mongoose.model('ModelConversation', conversationSchema);
export default ModelConversation