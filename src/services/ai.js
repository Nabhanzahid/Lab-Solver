import { robustJsonParse } from './utils';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];

/**
 * Shared AI Calling Logic
 */
export async function callAI(prompt, provider, apiKey, model, isJson = true) {
  if (provider === 'gemini') {
    const version = model.includes('1.5') ? 'v1' : 'v1beta';
    const isV1Beta = version === 'v1beta';
    
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        ...(isV1Beta && isJson ? {
          response_mime_type: "application/json"
        } : {})
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${err?.error?.message || response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return isJson ? robustJsonParse(text) : text;
  } else if (provider === 'groq') {
    const requestBody = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      ...(isJson ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.1,
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${err?.error?.message || response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    return isJson ? robustJsonParse(text) : text;
  } else {
    const requestBody = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      ...(isJson ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.1,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${err?.error?.message || response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    return isJson ? robustJsonParse(text) : text;
  }
}
