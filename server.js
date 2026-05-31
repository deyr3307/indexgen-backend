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

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const prompt = `You are an elite academic document synthesizer. Deeply analyze the following text and generate a Table of Contents.
    Synthesize professional headings (e.g., "Difference between X and Y" instead of random lines).

    CRITICAL RULES:
    1. OUTPUT FORMAT: You MUST return ONLY a valid JSON array. DO NOT include any markdown formatting like \`\`\`json. DO NOT add any introductory or concluding text (e.g., "Here is the output:").
    2. DATA STRUCTURE: Each object must exactly contain:
       - "chapter": A sequential serial number (e.g., "1", "2").
       - "title": The synthesized heading.
       - "page": Approximate page number.
    3. Always extract the top 10-15 logical sections. Never return an empty array.

    Document Text to Analyze:
    ${text}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let output = response.text();
    
    // Bulletproof JSON Extraction
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const cleanJson = jsonMatch[0];
      res.json(JSON.parse(cleanJson));
    } else {
      throw new Error("Failed to extract JSON array from Gemini response.");
    }

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: 'Failed to generate index.' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
