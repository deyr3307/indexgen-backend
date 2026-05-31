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
    const prompt = `You are an expert academic document analyzer. Analyze the following text (it may be unstructured class notes, biology taxonomy, or a lab report). 
    Extract ALL main topics, categories (e.g., Phylum, Class, Corals, Ecdysis), and key concepts as Table of Contents headings. Predict approximate page numbers.
    
    CRITICAL RULES:
    1. You MUST return a raw JSON array of objects. 
    2. Each object must have exactly these keys: "chapter" (use a serial number like "1", "2" if no formal chapter exists), "title" (the heading name), and "page".
    3. Even if the text is messy, extract the top 5-15 logical topics. DO NOT return an empty array.
    4. Return ONLY valid JSON. No markdown, no \`\`\`json blocks, no explanations.
    
    Document Text:
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
