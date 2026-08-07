/**
 * Shared utilities for Gemini and OpenAI services
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Tesseract from 'tesseract.js';

// Setup pdfjs worker using Vite URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Convert a File object to base64 string
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.name) {
      return reject(new Error("Invalid file object provided."));
    }
    
    const reader = new FileReader();
    
    // Safety timeout in case FileReader hangs indefinitely (browser bug)
    const timeout = setTimeout(() => {
      reject(new Error("File reading timed out after 10 seconds. Please try uploading the file again."));
      reader.abort();
    }, 10000);

    reader.onload = () => {
      clearTimeout(timeout);
      const result = reader.result;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };

    reader.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error("File reading failed natively."));
    };

    reader.onabort = () => {
      clearTimeout(timeout);
      reject(new Error("File reading was aborted by the browser."));
    };

    reader.readAsDataURL(file);
  });
}


/**
 * Get MIME type for file based on extension
 */
export function getMimeType(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mimeMap = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
  };
  return mimeMap[ext] || file.type || 'application/octet-stream';
}

/**
 * Robust JSON repair logic
 * Handles: Unescaped quotes, unescaped newlines, truncation, markdown blocks
 */
export function robustJsonParse(str) {
  let cleaned = str.trim();
  
  // 1. Remove Markdown blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // 2. Extract JSON part if model added extra text
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1) {
    // If we have an end brace, use it. If not (truncation), go to end of string and close later.
    cleaned = cleaned.substring(start, end !== -1 && end > start ? end + 1 : cleaned.length);
  }

  // 3. Balance Brackets and Braces (Truncation Recovery)
  let openBraces = (cleaned.match(/{/g) || []).length;
  let closeBraces = (cleaned.match(/}/g) || []).length;
  let openBrackets = (cleaned.match(/\[/g) || []).length;
  let closeBrackets = (cleaned.match(/]/g) || []).length;

  // Add missing closers in the correct order (Brackets usually inside Braces in our schema)
  while (openBrackets > closeBrackets) { cleaned += ']'; closeBrackets++; }
  while (openBraces > closeBraces) { cleaned += '}'; closeBraces++; }

  // 4. Cleanup trailing commas before closer (common in truncated arrays)
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(cleaned);
    // Recursively clean strings for escaped newlines (AI quirks)
    const deepClean = (obj) => {
      for (let key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = obj[key].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          deepClean(obj[key]);
        }
      }
      return obj;
    };
    return deepClean(parsed);
  } catch (e) {
    // 5. Aggressive repair for unescaped newlines/quotes
    let repaired = cleaned
      .replace(/\n/g, '\\n')
      .replace(/\\n\s*"/g, '"')
      .replace(/"\s*\\n/g, '"');
    
    try {
      const parsed2 = JSON.parse(repaired);
      return deepClean(parsed2);
    } catch (e2) {
      throw e2; 
    }
  }
}

/**
 * Dynamic Prompt Generator for Notebook Architect Mode
 */
export function getLabSolverPrompt() {
  return `Extract all experiments/tasks from the attached lab report into a LINEAR JUPYTER NOTEBOOK structure.

CRITICAL INSTRUCTIONS:
1. You MUST return EXACTLY ONE valid JSON object matching the requested schema.
2. The 'tasks' array MUST contain AT LEAST ONE task. If you cannot find any explicit tasks in the document, you MUST generate a default 'Data Exploration' task (Task 1) analyzing the document's general context.
3. For the "code" field, use single quotes (') for all internal Python strings.
4. Keep 'description' and 'solution' under 300 characters each. 
5. RUNTIME CONTEXT: This is a CONTINUOUS LINEAR EXECUTION. Tasks share variables (e.g., Task 1 defines 'df', Task 2 uses 'df' without importing it again).

6. FULL POWER DATA SCIENCE:
   - Use 'tensorflow', 'keras', 'scikit-learn', 'pandas', 'matplotlib' aggressively.
   - If no dataset is provided in the document, generate realistic structured mock data using numpy/pandas in Task 1, and use that mock data for all remaining tasks.

7. Ensure 'outputAnalysis' contains a realistic prediction of what the terminal/console would output upon running the generated python code.
   - CRITICAL: DO NOT use repetitive boilerplate phrases like "Upon running the provided code..." or "This demonstrates the solver's ability...". 
   - Write naturally and directly. State EXACTLY what the expected terminal output looks like and briefly explain its analytical meaning in a creative, varied tone.`;
}

/**
 * Shared Response Schema
 */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reportTitle: { type: "string" },
    subject: { type: "string" },
    totalTasks: { type: "integer" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskNumber: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          solution: { type: "string" },
          code: { type: "string" },
          hasCode: { type: "boolean" },
          expectedOutput: { type: "string" },
          outputAnalysis: { type: "string" }
        },
        required: ["taskNumber", "title", "description", "solution", "hasCode", "outputAnalysis"]
      }
    },
    conclusion: { type: "string" }
  },
  required: ["reportTitle", "tasks", "conclusion"]
};

/**
 * Universal local text extraction from PDF or Image (OCR)
 */
export async function extractTextFromFile(file, onProgress) {
  const mimeType = getMimeType(file);
  
  if (mimeType === 'application/pdf') {
    onProgress?.(10);
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
      onProgress?.(10 + (i / numPages) * 20);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }
    return fullText;
  } else if (mimeType.startsWith('image/')) {
    onProgress?.(10);
    const { data: { text } } = await Tesseract.recognize(file, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          onProgress?.(10 + m.progress * 20);
        }
      }
    });
    return text;
  } else {
    return await file.text();
  }
}
