const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

dotenv.config();

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '100mb' }));

// Multer - memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('শুধু PDF, DOCX, TXT, Image ফাইল সাপোর্ট করে'));
  }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Health check
app.get('/', (req, res) => {
  res.json({ status: '✅ IndexGen Backend চলছে - Vision Mode Active', version: '3.0' });
});

// PDF to base64 images using pdftoppm (poppler)
function pdfToImages(pdfBuffer) {
  const tmpDir = `/tmp/pdf_${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  
  const pdfPath = `${tmpDir}/input.pdf`;
  fs.writeFileSync(pdfPath, pdfBuffer);
  
  try {
    // pdftoppm দিয়ে PDF থেকে image বানাও (Render-এ poppler available)
    execSync(`pdftoppm -jpeg -r 150 "${pdfPath}" "${tmpDir}/page"`, { timeout: 60000 });
    
    const files = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort();
    
    const images = files.map(f => {
      const imgBuffer = fs.readFileSync(`${tmpDir}/${f}`);
      return imgBuffer.toString('base64');
    });
    
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return images;
    
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('PDF থেকে image convert করতে পারেনি: ' + err.message);
  }
}

// MAIN ROUTE - Gemini Vision দিয়ে হাতে লেখা PDF পড়বে
app.post('/api/generate-index', upload.single('file'), async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { temperature: 0.1, topP: 0.8 }
    });

    let contentParts = [];
    let isImageMode = false;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      
      if (ext === '.pdf') {
        console.log('📄 PDF পাওয়া গেছে, image-এ convert করছি...');
        
        let images;
        try {
          images = pdfToImages(req.file.buffer);
          console.log(`✅ ${images.length} page image তৈরি হয়েছে`);
          isImageMode = true;
        } catch (convErr) {
          console.log('⚠️ pdftoppm fail, direct PDF send করছি...');
          // pdftoppm না থাকলে directly PDF base64 পাঠাও
          const pdfBase64 = req.file.buffer.toString('base64');
          contentParts.push({
            inlineData: { mimeType: 'application/pdf', data: pdfBase64 }
          });
        }
        
        if (isImageMode && images && images.length > 0) {
          // প্রতিটা page image add করো (max 15 pages)
          const maxPages = Math.min(images.length, 15);
          for (let i = 0; i < maxPages; i++) {
            contentParts.push({
              inlineData: { mimeType: 'image/jpeg', data: images[i] }
            });
          }
        }
        
      } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
        contentParts.push({
          inlineData: { mimeType, data: req.file.buffer.toString('base64') }
        });
        isImageMode = true;
        
      } else if (ext === '.txt') {
        const text = req.file.buffer.toString('utf-8');
        if (text.trim().length < 50) {
          return res.status(400).json({ error: 'টেক্সট খুব ছোট' });
        }
        contentParts.push({ text: `DOCUMENT TEXT:\n${text.substring(0, 30000)}` });
        
      } else if (['.docx', '.doc'].includes(ext)) {
        // DOCX এর জন্য mammoth ব্যবহার
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        const text = result.value;
        if (text.trim().length < 50) {
          return res.status(400).json({ error: 'DOCX ফাইলে পর্যাপ্ত টেক্সট নেই' });
        }
        contentParts.push({ text: `DOCUMENT TEXT:\n${text.substring(0, 30000)}` });
      }
      
    } else if (req.body.text) {
      const text = req.body.text;
      if (text.trim().length < 20) {
        return res.status(400).json({ error: 'টেক্সট খুব ছোট' });
      }
      contentParts.push({ text: `DOCUMENT TEXT:\n${text.substring(0, 30000)}` });
      
    } else {
      return res.status(400).json({ error: 'কোনো ফাইল বা text পাওয়া যায়নি' });
    }

    // Prompt add করো
    const prompt = isImageMode 
      ? `You are an expert at reading handwritten academic documents. These images contain handwritten assignment pages.

TASK: Read ALL the handwritten text carefully and create a complete Table of Contents / Index.

CRITICAL INSTRUCTIONS:
1. Read every page image carefully - it's handwritten notes
2. Identify every major topic, heading, section marked with symbols like ⊞, *, ** etc.
3. Return ONLY a valid JSON array, nothing else, no markdown backticks
4. Each object MUST have: "chapter" (number), "title" (topic name), "page" (page number)
5. Include ALL topics found across all pages

Return format example:
[{"chapter":1,"title":"Classification of Protista","page":1},{"chapter":2,"title":"Ecdysis","page":3}]`
      : `You are an expert academic document analyzer. Create a complete Table of Contents.

INSTRUCTIONS:
1. Identify ALL major topics, chapters, sections
2. Return ONLY a valid JSON array, no markdown, no backticks
3. Each object: "chapter" (number), "title" (topic name), "page" (page number)`;

    contentParts.push({ text: prompt });

    console.log('🤖 Gemini Vision API call করছি...');
    const result = await model.generateContent(contentParts);
    const response = await result.response;
    let output = response.text();

    console.log('Raw output (500 chars):', output.substring(0, 500));

    // JSON clean করো
    output = output.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.length === 0) throw new Error('AI empty index তৈরি করেছে');
      console.log(`✅ Index তৈরি হয়েছে: ${parsed.length} টি item`);
      return res.json(parsed);
    } else {
      console.error('JSON match হয়নি। Full output:', output);
      throw new Error('AI থেকে valid JSON আসেনি');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('API_KEY') || error.message.includes('API key')) {
      return res.status(500).json({ error: 'GEMINI_API_KEY সঠিক নয়' });
    }
    if (error.message.includes('quota') || error.message.includes('429')) {
      return res.status(429).json({ error: 'AI quota শেষ। কিছুক্ষণ পর try করো' });
    }
    if (error.message.includes('timeout')) {
      return res.status(504).json({ error: 'Request timeout। PDF অনেক বড়, ছোট করে try করো' });
    }
    
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Multer error
app.use((error, req, res, next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'ফাইল 30MB এর বেশি হতে পারবে না' });
  }
  res.status(400).json({ error: error.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ IndexGen Backend v3.0 চলছে port ${PORT}-এ`);
});
