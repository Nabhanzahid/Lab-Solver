import { 
  fileToBase64, 
  getMimeType, 
  robustJsonParse, 
  getLabSolverPrompt,
  RESPONSE_SCHEMA
} from './utils';

/**
 * Main function: send lab report to OpenAI and return structured result
 */
export async function solveLabReportOpenAI(file, apiKey, onProgress, model = 'gpt-4o', extraContext = '') {
  onProgress?.(5);

  const base64Data = await fileToBase64(file);
  const mimeType = getMimeType(file);

  onProgress?.(35);

  // Determine content part based on MIME type
  const isPdf = mimeType === 'application/pdf';
  const filePart = isPdf 
    ? {
        type: "file",
        file: {
          file_data: `data:${mimeType};base64,${base64Data}`,
          filename: file.name
        }
      }
    : {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64Data}`
        }
      };

  onProgress?.(50);

  // OpenAI request body using Structured Outputs (json_schema)
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
        content: [
          {
            type: "text",
            text: `Analyze this lab report. ${extraContext || ''}`
          },
          filePart
        ]
      }
    ],
    response_format: { 
      type: "json_schema",
      json_schema: {
        name: "lab_report_solution",
        strict: false, 
        schema: RESPONSE_SCHEMA
      }
    },
    temperature: 0.1,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
    throw new Error(`OpenAI API error: ${msg}`);
  }

  const data = await response.json();
  onProgress?.(85);

  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('OpenAI returned an empty response.');
  }

  try {
    onProgress?.(95);
    return robustJsonParse(rawText);
  } catch {
    console.error("Critical JSON Parse Failure.\nRaw:", rawText);
    throw new Error(`The OpenAI solution was generated but contained structural errors. Please try again.`);
  }
}
