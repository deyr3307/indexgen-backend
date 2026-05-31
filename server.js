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
      return res.status(400).json({ error: 'কোনো টেক্সট পাওয়া যায়নি।' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Read and analyze the following academic document deeply. Extract the actual main headings, sub-headings, and predict the page numbers based on the text. Return ONLY a strictly formatted JSON array representing the Table of Contents, like this: [{"chapter": "1", "title": "Introduction", "page": "3"}]. Do not return markdown, just JSON.\n\nDocument Text:\n${text}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let output = response.text();
    
    // Clean up JSON format
    output = output.replace(/```json/g, '').replace(/```/g, '').trim();

    res.json(JSON.parse(output));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'ইনডেক্স তৈরি করতে সমস্যা হয়েছে।' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`সার্ভার চলছে ${PORT} পোর্টে`);
});
