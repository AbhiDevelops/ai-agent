import ModelConversation from "./Model.js";
async function appendTurnToConversation(sessionId, userText, aiText) {
  try {
    const newTurn = {
      userTranscript: userText,
      modelResponse: aiText,
      timestamp: new Date()
    };

    const updatedDoc = await ModelConversation.findOneAndUpdate(
      { sessionId: sessionId }, // Find the conversation by ID
      { $push: { turns: newTurn } }, // Append to the 'turns' array
      { upsert: true, new: true }   // Create if it doesn't exist; return updated doc
    );

    console.log("Turn successfully appended to MongoDB.");
    return updatedDoc;
  } catch (error) {
    console.error("Error saving to MongoDB:", error);
  }
}

export default appendTurnToConversation