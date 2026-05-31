const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

dotenv.config();

const app = express();

// ✅ CORS - সব origin allow করা হয়েছে (Render + AI Studio frontend এর জন্য)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));

// ✅ Multer - ফাইল memory-তে রাখবে (disk এ না)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('শুধু PDF, DOCX, DOC, TXT ফাইল সাপোর্ট করে'));
    }
  }
});

// ✅ Gemini AI setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Health check route - Render verify করার জন্য
app.get('/', (req, res) => {
  res.json({ status: 'IndexGen Backend চলছে ✅', version: '2.0' });
});

// ✅ Text থেকে extract করার helper functions
async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (ext === '.txt') {
    return file.buffer.toString('utf-8');
  }

  throw new Error('Unsupported file type');
}

// ✅ MAIN ROUTE - ফাইল দিয়ে index generate করা
app.post('/api/generate-index', upload.single('file'), async (req, res) => {
  try {
    let text = '';

    // ফাইল আছে কিনা চেক
    if (req.file) {
      console.log('ফাইল পাওয়া গেছে:', req.file.originalname);
      text = await extractTextFromFile(req.file);
    } else if (req.body.text) {
      // Direct text ও accept করবে
      text = req.body.text;
    } else {
      return res.status(400).json({
        error: 'কোনো ফাইল বা text পাওয়া যায়নি। file বা text পাঠাও।'
      });
    }

    // Text খুব ছোট হলে error
    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        error: 'Document-এ পর্যাপ্ত text নেই। কমপক্ষে 50 character লাগবে।'
      });
    }

    console.log('Text extracted, length:', text.length);

    // ✅ Gemini AI call
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        topK: 10,
      }
    });

    const prompt = `You are a world-class academic document analyzer. Analyze this document and create a detailed table of contents / index.

CRITICAL INSTRUCTIONS:
1. UNIVERSAL DEEP ANALYSIS: Read the text thoroughly and identify ALL chapters, sections, and major topics.
2. STRICT JSON: Return ONLY a valid JSON array and nothing else. No markdown, no backticks, no explanation.
3. FORMAT: Each object MUST have exactly these fields:
   - "chapter": Serial number (1, 2, 3...)
   - "title": The accurately synthesized heading/topic name
   - "page": The predicted page number (estimate based on content position)
4. ACCURACY OVER SPEED: Take your time. Never guess randomly.
5. If this is a lab report, identify: Title, Objective, Theory, Apparatus, Procedure, Observations, Results, Calculations, Discussion, Conclusion, References.

DOCUMENT TEXT:
${text.substring(0, 30000)}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let output = response.text();

    console.log('AI Raw Output (first 500 chars):', output.substring(0, 500));

    // JSON extract করা - markdown backticks থাকলেও কাজ করবে
    output = output.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Array খোঁজা
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const cleanJson = jsonMatch[0];
      const parsedArray = JSON.parse(cleanJson);

      if (parsedArray.length === 0) {
        throw new Error('AI empty index তৈরি করেছে');
      }

      console.log('Index তৈরি হয়েছে, items:', parsedArray.length);
      return res.json(parsedArray);
    } else {
      console.error('JSON match হয়নি। Raw output:', output);
      throw new Error('AI থেকে valid JSON আসেনি');
    }

  } catch (error) {
    console.error('Error:', error.message);

    // Specific error messages
    if (error.message.includes('API_KEY')) {
      return res.status(500).json({ error: 'GEMINI_API_KEY সঠিক নয় বা set করা হয়নি' });
    }
    if (error.message.includes('quota')) {
      return res.status(429).json({ error: 'AI API quota শেষ হয়ে গেছে। পরে try করো।' });
    }

    return res.status(500).json({
      error: error.message || 'Server-এ সমস্যা হয়েছে',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ✅ Multer error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'ফাইল সাইজ 20MB এর বেশি হতে পারবে না' });
    }
  }
  res.status(400).json({ error: error.message });
});

// ✅ PORT - Render এর জন্য process.env.PORT ব্যবহার করা MUST
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ IndexGen Backend চলছে port ${PORT}-এ`);
});
