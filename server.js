const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/generate-index', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `You are an elite academic document synthesizer. Your task is to deeply analyze the following extracted text from an uploaded document (which could be anything from lab reports, handwritten biology notes, to business cases) and generate a highly accurate, logically structured Table of Contents.

    CRITICAL INSTRUCTIONS:
    1. DEEP CONTEXTUAL UNDERSTANDING: Do not just pick random lines. Synthesize clean, professional headings. For example, if the text discusses differences between two things, the heading should be "Difference between X and Y". If it describes a process, use "Process of X".
    2. UNIVERSAL ADAPTABILITY: This must work flawlessly for ANY subject. Identify the major thematic shifts to form the main headings (e.g., Protista, Ecdysis, Air Sacs, etc.).
    3. STRICT JSON OUTPUT: You MUST return ONLY a raw JSON array of objects. No markdown formatting (\`\`\`json), no introductory text.
    4. DATA STRUCTURE: Each object must exactly contain:
       - "chapter": A sequential serial number (e.g., "1", "2", "3").
       - "title": The synthesized, professional heading name.
       - "page": Predict the approximate page number based on text flow.
    5. NEVER return an empty array. Always extract the top 10-15 logical sections.

    Document Text to Analyze:
    ${text}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let output = response.text();
    
    // Clean up JSON format
    output = output.replace(/```json/g, '').replace(/```/g, '').trim();

    res.json(JSON.parse(output));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate index.' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
