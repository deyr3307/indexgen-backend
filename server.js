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
  res.json({ status: '✅ IndexGen Backend চলছে - Vision Mode Active', version: '3.1' });
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

// ============================================================
// PROMPT BUILDER
// এখানেই মূল ফিক্স: AI কে কড়াভাবে বলা হচ্ছে যে শুধু MAIN/CORE
// topic নিতে হবে। sub-heading যেমন "Characteristics:", "Process",
// "Importance" ইত্যাদি আলাদা index entry হবে না — এগুলো তার
// উপরের main topic-এর part হিসেবে ধরা হবে এবং বাদ দেওয়া হবে।
// ============================================================
function buildPrompt(isImageMode) {
  const baseRules = `
You are creating a clean, professional Table of Contents (Index) for an academic
assignment/practical notebook, in the exact style of a printed index page —
short, single-page, only major headings.

WHAT COUNTS AS A "CORE / MAIN HEADING" (INCLUDE these):
- Chapter or experiment titles (e.g. "Systematic position of Dero dorsalis",
  "Classification of Protista", "Canal System in Sponges")
- Major distinct subject/topic names that a reader would look up in an index
- Each major topic should appear ONLY ONCE in the final list

WHAT IS NOT A CORE HEADING (NEVER include these as separate entries):
- Generic sub-labels that repeat under almost every topic, such as:
  "Characteristics:", "Characteristics", "Diagram", "Structure", "Definition",
  "Classification" (when it's just a sub-section of a topic above it),
  "Types", "Examples", "Conclusion", "Observation", "Result", "Note"
- These generic sub-labels are PART of the main heading above them.
  Do NOT create a separate row for "Characteristics:" after every species name.
  Merge them silently into the main topic — i.e. just skip them, do not list them.
- Page numbers that repeat the same heading (duplicates) — keep only the first occurrence.

DEDUPLICATION RULE:
- If you see "Systematic position of X" followed shortly by "Characteristics:",
  these are ONE topic, not two. Only output "Systematic position of X" with its
  page number. Skip "Characteristics:" entirely.
- Never output two consecutive entries where the second one is just a generic
  word like "Characteristics:" — if that happens, remove it.

OUTPUT RULES:
1. Return ONLY a valid JSON array. No markdown, no backticks, no explanation text.
2. Each object MUST have exactly these keys: "chapter" (number, sequential starting at 1),
   "title" (string, the clean main topic name only), "page" (number).
3. The final list should read like a real printed index — typically one entry per
   distinct topic/experiment, NOT one entry per sub-section.
4. Keep "title" concise — use the topic name as written, but do not include trailing
   colons (":") or the word "Characteristics" appended to it.
5. Sort entries by their page number, ascending.
6. Do not invent topics that are not in the document, and do not skip real topics —
   only skip the generic repeating sub-labels described above.`;

  if (isImageMode) {
    return `You are an expert at reading handwritten academic documents. These images
contain handwritten assignment/practical pages, page by page.

TASK: Read ALL the handwritten text carefully across every page image and build the
Table of Contents using ONLY the core/main topic headings (see rules below).
${baseRules}

EXAMPLE — given pages containing:
"1. Systematic position of Dero dorsalis ... page 1"
"2. Characteristics: ... page 1"
"3. Systematic Position of Tubifex tubifex ... page 2"
"4. Characteristics: ... page 2"

The CORRECT output is:
[{"chapter":1,"title":"Systematic position of Dero dorsalis","page":1},{"chapter":2,"title":"Systematic position of Tubifex tubifex","page":2}]

NOT four entries — only two, because "Characteristics:" is a sub-label, not a core heading.

Return ONLY the JSON array now.`;
  }

  return `You are an expert academic document analyzer. Build a clean Table of Contents
using ONLY the core/main topic headings (see rules below).
${baseRules}

Return ONLY the JSON array now.`;
}

// MAIN ROUTE - Gemini Vision দিয়ে হাতে লেখা PDF পড়বে
app.post('/api/generate-index', upload.single('file'), async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
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
          isImageMode = true; // PDF এর জন্যও same strict prompt লাগবে
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

    // Prompt add করো (fixed, strict, deduplicating prompt)
    const prompt = buildPrompt(isImageMode);
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
      let parsed = JSON.parse(jsonMatch[0]);
      if (parsed.length === 0) throw new Error('AI empty index তৈরি করেছে');

      // ============================================================
      // SAFETY NET (server-side, in case AI still leaks a sub-label)
      // Model নির্ভরযোগ্য হলেও কখনো কখনো generic sub-label slip করতে
      // পারে। এখানে একটা ছোট blacklist filter দিয়ে সেগুলো বাদ দেওয়া
      // হচ্ছে, যাতে output সব সময় clean থাকে।
      // ============================================================
      const genericLabels = [
        'characteristics', 'characteristic', 'diagram', 'structure',
        'definition', 'types', 'examples', 'example', 'conclusion',
        'observation', 'result', 'note'
      ];
      parsed = parsed.filter(item => {
        const t = (item.title || '').trim().toLowerCase().replace(/:$/, '');
        return !genericLabels.includes(t);
      });

      // Re-number chapters sequentially after filtering
      parsed = parsed.map((item, idx) => ({ ...item, chapter: idx + 1 }));

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
  console.log(`✅ IndexGen Backend v3.1 চলছে port ${PORT}-এ`);
});
