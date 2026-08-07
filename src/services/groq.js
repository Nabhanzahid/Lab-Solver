import { 
  fileToBase64, 
  getMimeType, 
  robustJsonParse, 
  getLabSolverPrompt,
  RESPONSE_SCHEMA,
  extractTextFromFile
} from './utils';

/**
 * Main function: send lab report to Groq and return structured result
 */
export async function solveLabReportGroq(file, apiKey, onProgress, model = 'llama-3.2-11b-vision-preview', extraContext = '') {
  onProgress?.(5);

  const mimeType = getMimeType(file);
  const isVisionModel = model.includes('vision');
  
  let messagesContent = [];

  if (isVisionModel) {
    const base64Data = await fileToBase64(file);
    const isPdf = mimeType === 'application/pdf';
    const imageUrl = `data:${isPdf ? 'application/pdf' : mimeType};base64,${base64Data}`;
    
    messagesContent = [
      {
        type: "text",
        text: `Analyze this lab report. ${extraContext || ''}`
      },
      {
        type: "image_url",
        image_url: { url: imageUrl }
      }
    ];
    onProgress?.(35);
  } else {
    // Model is text-only. Extract text locally via PDF parser or OCR!
    const extractedText = await extractTextFromFile(file, onProgress);
    
    if (!extractedText || extractedText.trim() === '') {
      throw new Error(`Failed to extract text from the file locally. Please try a different file or switch to a Vision model.`);
    }

    messagesContent = [
      {
        type: "text",
        text: `Analyze the following extracted text from the lab report:\n\n${extractedText}\n\n${extraContext || ''}`
      }
    ];
    onProgress?.(35);
  }

  onProgress?.(50);

  // Groq API uses an OpenAI-compatible endpoint
  const prompt = getLabSolverPrompt();
  const requestBody = {
    model: model,
    messages: [
      {
        role: "system",
        content: `You are a Lab Lab Report Assistant. Analyze the document and internalize all tasks. 
        Respond with a JSON object following the provided schema. ${prompt}`
      },
      {
        role: "user",
        content: messagesContent
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
  });

  onProgress?.(70);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Groq API error: ${msg}`);
  }

  const data = await response.json();
  onProgress?.(85);

  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('Groq returned an empty response.');
  }

  try {
    onProgress?.(95);
    return robustJsonParse(rawText);
  } catch (err) {
    console.error("Critical JSON Parse Failure.\nRaw:", rawText);
    throw new Error(`The Groq solution was generated but contained structural errors. Please try again.`);
  }
}
