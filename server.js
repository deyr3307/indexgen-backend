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
    
    if (!text || text.trim().length < 50) {
      console.log("Error: Text is too short or empty.");
      return res.status(400).json({ error: 'পিডিএফ থেকে পর্যাপ্ত টেক্সট পাওয়া যায়নি।' });
    }

    // Deep Analysis Mode (Temperature 0.1 for high logic and analytical accuracy)
        const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
            temperature: 0.1, 
            topP: 0.8,
            topK: 10,
        }
    });
    
    
    // Universal Prompt for ANY subject (Science, Business, IT, etc.)
    const prompt = `You are a world-class academic and professional document analyzer, equivalent to the most advanced AI in the world. Your ONLY job is to deeply read the following extracted text from a document (which could be anything from a scientific lab report, an environmental impact study, a business analysis, or programming notes) and generate a perfectly accurate, logical Table of Contents.

    CRITICAL INSTRUCTIONS:
    1. UNIVERSAL DEEP ANALYSIS: Read the text thoroughly. Identify the actual core topics, analytical sections, or chapters. Synthesize professional headings based on the actual context (e.g., "Introduction to the Study", "Methodology and Framework", "Detailed Data Analysis", "Conclusion and Recommendations"). Do NOT make up headings.
    2. STRICT JSON: Return ONLY a valid JSON array. No markdown (\`\`\`json), no introductory words.
    3. FORMAT: Each object MUST have:
       - "chapter": Serial number (1, 2, 3...)
       - "title": The accurately synthesized heading.
       - "page": The predicted page number.
    4. ACCURACY OVER SPEED: Take your time. Never return dummy data or an empty array. If the document is unstructured, logically divide it into 5-15 main conceptual themes.

    DOCUMENT TEXT:
    ${text.substring(0, 30000)}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let output = response.text();
    
    console.log("Raw Output:", output);

    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const cleanJson = jsonMatch[0];
      const parsedArray = JSON.parse(cleanJson);
      
      if (parsedArray.length === 0) {
         throw new Error("AI generated an empty array after analysis.");
      }
      return res.json(parsedArray);
    } else {
      throw new Error("Failed to extract JSON format.");
    }

  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: 'ডকুমেন্ট অ্যানালাইসিস করতে সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।' });
  }
});

const PORT = process.env.PORT || 30000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
