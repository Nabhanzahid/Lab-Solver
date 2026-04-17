// ─────────────────────────────────────────────────────────────
// gemini.js  –  Gemini API service
// ─────────────────────────────────────────────────────────────

import { buildMasterPrompt, RESPONSE_SCHEMA } from './prompt.js';

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

export async function solveLabReport(file, apiKey, onProgress, model = 'gemini-2.5-flash', extraContext = '') {
  onProgress?.(5);
  const base64 = await fileToBase64(file);
  const mime   = getMimeType(file);

  onProgress?.(30);
  const prompt = buildMasterPrompt(extraContext);

  onProgress?.(50);

  const isV1    = model.includes('1.5');
  const version = isV1 ? 'v1' : 'v1beta';
  const useStructured = version === 'v1beta';

  const body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: mime, data: base64 } }
    ]}],
    generationConfig: {
      temperature: 0.1,
      max_output_tokens: 65536,
      ...(useStructured ? {
        response_mime_type: 'application/json',
        response_schema: RESPONSE_SCHEMA,
      } : {}),
    },
  };

  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
  const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  onProgress?.(70);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e   = new Error(`Gemini API error: ${err?.error?.message || res.status}`);
    e.status  = res.status;
    throw e;
  }

  const json = await res.json();
  onProgress?.(85);

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');

  onProgress?.(95);
  return parseLabResponse(text);
}

function parseLabResponse(text) {
  // Strip markdown code fences if present
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Try to extract JSON object from surrounding text
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse AI response as JSON. Please try again.');
  }
}
