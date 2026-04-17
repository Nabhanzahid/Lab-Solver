// ─────────────────────────────────────────────────────────────
// analyzer.js  –  Lightweight first-pass resource detection
//
// Reads the lab report file and outputs a JSON list of all
// external files required (datasets/images/etc) WITHOUT
// generating any code or solutions. Fast (~2-4s).
// ─────────────────────────────────────────────────────────────

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMimeType(file) {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop().toLowerCase();
  const map = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
                 jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────
// Analyzer prompt — very specific about what it needs to return
// ─────────────────────────────────────────────────────────────
const ANALYZER_PROMPT = `You are analyzing a student's lab report to detect what EXTERNAL files are needed to run it.

DO NOT solve tasks, generate code, or write explanations.
ONLY identify files that the student must provide from outside (real datasets, real images, etc.).

INFERENCE RULE: Even if a file is not explicitly named (e.g., 'Load the image' instead of 'Load scan.jpg'), you MUST create a requirement for it with a reasonable inferred name and type. If a task requires a dataset, it is a CSV requirement. If it mentions visual data, it is an Image requirement.

For each required external file, extract:
1. TYPE: "csv" (tabular/spreadsheet data), "image" (photo, scan, medical image, etc.), or "other"
2. FILENAME: the exact filename mentioned in the lab, or a reasonable inferred name
3. DESCRIPTION: plain-language description of what this data represents and why it is needed
4. For CSV files — REQUIRED COLUMNS: list every column/feature name mentioned or implied in the tasks.
   Be exhaustive: if a task does regression on "salary predicted from age and experience", list [age, experience, salary].
5. For image files — IMAGE TYPE: describe exactly what kind of image (e.g., "Grayscale chest X-ray for histogram equalization", "Color face photo for edge detection", "Handwritten digit image (28x28)")
6. SAMPLE SIZE HINT (CSV only): recommended number of rows
7. TASKS USED: which task numbers reference this file

Return ONLY valid JSON like this (no markdown, no extra text):
{
  "hasRequirements": true,
  "summary": "One-line summary of what external files are needed",
  "requirements": [
    {
      "id": "r1",
      "type": "csv",
      "filename": "patients.csv",
      "description": "Patient health records used for heart disease classification across Tasks 1-3",
      "required_columns": ["age", "blood_pressure", "cholesterol", "heart_rate", "diagnosis"],
      "sample_size_hint": "150-300 rows recommended",
      "tasks_used": [1, 2, 3]
    },
    {
      "id": "r2",
      "type": "image",
      "filename": "xray.jpg",
      "image_type": "Grayscale chest X-ray for histogram equalization and CLAHE processing",
      "description": "Medical X-ray image used for image enhancement and edge detection in Tasks 4-5",
      "tasks_used": [4, 5]
    }
  ]
}

If the lab needs NO external files (it can work with fully generated mock data), return:
{ "hasRequirements": false, "summary": "No external files required — mock data will be generated", "requirements": [] }`;

// ─────────────────────────────────────────────────────────────
// Schema for Gemini structured output
// ─────────────────────────────────────────────────────────────
const ANALYZER_SCHEMA = {
  type: 'object',
  properties: {
    hasRequirements: { type: 'boolean' },
    summary:         { type: 'string'  },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:               { type: 'string' },
          type:             { type: 'string' },
          filename:         { type: 'string' },
          description:      { type: 'string' },
          required_columns: { type: 'array', items: { type: 'string' } },
          image_type:       { type: 'string' },
          sample_size_hint: { type: 'string' },
          tasks_used:       { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'type', 'filename', 'description'],
      },
    },
  },
  required: ['hasRequirements', 'requirements'],
};

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────
export async function analyzeLabRequirements(file, provider, apiKey, model) {
  const base64 = await fileToBase64(file);
  const mime   = getMimeType(file);

  if (provider === 'gemini') {
    const v = model.includes('1.5') ? 'v1' : 'v1beta';
    const body = {
      contents: [{ parts: [
        { text: ANALYZER_PROMPT },
        { inline_data: { mime_type: mime, data: base64 } },
      ]}],
      generationConfig: {
        temperature: 0.1,
        max_output_tokens: 4096,
        ...(v === 'v1beta' ? {
          response_mime_type: 'application/json',
          response_schema: ANALYZER_SCHEMA,
        } : {}),
      },
    };
    const url = `https://generativelanguage.googleapis.com/${v}/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Analyzer error: ${err?.error?.message || res.status}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Analyzer returned empty response');
    return parseJSON(text);

  } else {
    // OpenAI
    const fileContent = mime === 'application/pdf'
      ? { type: 'file', file: { file_data: `data:${mime};base64,${base64}`, filename: file.name } }
      : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };

    const body = {
      model,
      messages: [
        { role: 'system', content: ANALYZER_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: 'Analyze this lab report and list all required external files with full details.' },
          fileContent,
        ]},
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 2048,
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Analyzer error: ${err?.error?.message || res.status}`);
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Analyzer returned empty response');
    return parseJSON(text);
  }
}

function parseJSON(text) {
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse analyzer response as JSON');
  }
}
