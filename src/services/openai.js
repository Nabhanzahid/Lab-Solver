// ─────────────────────────────────────────────────────────────
// openai.js  –  OpenAI API service
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
                 jpeg: 'image/jpeg', webp: 'image/webp' };
  return map[ext] || 'application/octet-stream';
}

export async function solveLabReportOpenAI(file, apiKey, onProgress, model = 'gpt-4o', extraContext = '') {
  onProgress?.(5);
  const base64 = await fileToBase64(file);
  const mime   = getMimeType(file);

  onProgress?.(35);
  const prompt = buildMasterPrompt(extraContext);

  onProgress?.(50);

  const fileContent = mime === 'application/pdf'
    ? { type: 'file', file: { file_data: `data:${mime};base64,${base64}`, filename: file.name } }
    : { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };

  const body = {
    model,
    messages: [
      { role: 'system', content: `You are an expert Lab Report Solver. ${prompt}` },
      { role: 'user',   content: [{ type: 'text', text: `Analyze and solve this lab report.${extraContext ? ' ' + extraContext : ''}` }, fileContent] },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'lab_report_solution', strict: false, schema: RESPONSE_SCHEMA },
    },
    temperature: 0.1,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  onProgress?.(70);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API error: ${err?.error?.message || res.status}`);
  }

  const json = await res.json();
  onProgress?.(85);

  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty response.');

  onProgress?.(95);
  const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse OpenAI response as JSON. Please try again.');
  }
}
