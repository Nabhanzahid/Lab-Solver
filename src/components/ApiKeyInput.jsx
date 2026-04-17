import { useState } from 'react';

export default function ApiKeyInput({ apiKey, setApiKey, provider = 'gemini' }) {
  const [show, setShow] = useState(false);

  const isGemini = provider === 'gemini';
  const label = isGemini ? 'Gemini API Key' : 'OpenAI API Key';
  const placeholder = isGemini ? 'AIza...' : 'sk-...';
  const link = isGemini ? 'https://aistudio.google.com/apikey' : 'https://platform.openai.com/api-keys';
  const host = isGemini ? 'aistudio.google.com' : 'platform.openai.com';

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
      </div>
    </div>
  );
}
