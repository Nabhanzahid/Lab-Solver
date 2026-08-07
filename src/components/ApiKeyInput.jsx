import { useState } from 'react';

export default function ApiKeyInput({ apiKey, setApiKey, provider = 'gemini' }) {
  const [show, setShow] = useState(false);

  const isGemini = provider === 'gemini';
  const isGroq = provider === 'groq';
  
  let label = 'OpenAI API Key';
  let placeholder = 'sk-...';
  let link = 'https://platform.openai.com/api-keys';
  let host = 'platform.openai.com';
  
  if (isGemini) {
    label = 'Gemini API Key';
    placeholder = 'AIza...';
    link = 'https://aistudio.google.com/apikey';
    host = 'aistudio.google.com';
  } else if (isGroq) {
    label = 'Groq API Key';
    placeholder = 'gsk_...';
    link = 'https://console.groq.com/keys';
    host = 'console.groq.com';
  }

  return (
    <div className="api-key-section">
      <div className="api-key-label">
        <span>🔑</span> {label}
      </div>
      <div className="api-key-wrap">
        <input
          id="api-key-input"
          className="api-key-input"
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="api-key-toggle"
          onClick={() => setShow(s => !s)}
          title={show ? 'Hide key' : 'Show key'}
          type="button"
        >
          {show ? '🙈' : '👁️'}
        </button>
      </div>
      <div className="api-key-hint">
        <span>✨</span>
        Get your key at{' '}
        <a href={link} target="_blank" rel="noreferrer">
          {host}
        </a>
        {isGemini && ' — no credit card needed'}
        {isGroq && ' — lightning fast inferences'}
      </div>
    </div>
  );
}
