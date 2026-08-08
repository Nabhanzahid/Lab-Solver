import { 
  fileToBase64, 
  getMimeType, 
  robustJsonParse, 
  getLabSolverPrompt,
  RESPONSE_SCHEMA 
} from './utils';

/**
 * Main function: send lab report to Gemini and return structured result
 */
export async function solveLabReport(file, apiKey, onProgress, model = 'gemini-2.0-flash', extraContext = '') {
  console.log("ENTERING solveLabReport");
  onProgress?.(5);

  console.log("AWAITING fileToBase64...");
  const base64Data = await fileToBase64(file);
  console.log("FINISHED fileToBase64. AWAITING mimeType...");
  const mimeType = getMimeType(file);

  onProgress?.(35);
  console.log("FINISHED mimeType. COMPILING prompt...");

  const prompt = getLabSolverPrompt();

  onProgress?.(50);
  console.log("PROMPT COMPILED. PREPARING FETCH...");

  const version = model.includes('1.5') ? 'v1' : 'v1beta';
  const isV1Beta = version === 'v1beta';

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n${extraContext || ''}`,
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      max_output_tokens: 8192,
      ...(isV1Beta ? {
        response_mime_type: "application/json",
        response_schema: RESPONSE_SCHEMA
      } : {})
    },
  };

  const apiUrl = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;
  const response = await fetch(`${apiUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  onProgress?.(70);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    const error = new Error(`Gemini API error: ${msg}`);
    error.status = response.status; // Attach status for fallback logic
    throw error;
  }

  const data = await response.json();
  onProgress?.(85);

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  try {
    onProgress?.(95);
    return robustJsonParse(rawText);
  } catch {
    console.error("Critical JSON Parse Failure.\nRaw:", rawText);
    throw new Error(`The lab report solution was generated but contained structural errors. This often happens with very long tasks. Please try uploading again or using a shorter document.`);
  }
}
