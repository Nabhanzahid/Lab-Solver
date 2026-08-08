import { useEffect, useState } from 'react';

const MESSAGES = [
  '📖 Reading your lab report...',
  '🔍 Identifying lab tasks...',
  '🧠 Analysing each task with Gemini AI...',
  '⚗️  Generating step-by-step solutions...',
  '🐍 Preparing Python code for execution...',
  '✅ Verifying outputs...',
  '📋 Writing conclusion...',
  '✨ Almost done...',
];

export default function LoadingScreen({ progress, statusOverride, fallbackMsg }) {
  let currentStatus = 'Starting...';
  if (progress < 10) currentStatus = 'Preparing lab report...';
  else if (progress < 25) currentStatus = 'Reading file contents...';
  else if (progress < 40) currentStatus = 'Connecting to AI Model API...';
  else if (progress < 80) currentStatus = 'AI is thinking... (High compute node)';
  else if (progress < 100) currentStatus = 'Finalizing results...';

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-spinner">
          <div className="spinner-ring" />
          <div className="spinner-ring" />
          <div className="loading-emoji">
            {progress < 40 ? '📖' : progress < 80 ? '🧪' : '✅'}
          </div>
        </div>
        <div className="loading-title">Lab Solver AI</div>
        <div className="loading-msg">{statusOverride || currentStatus}</div>
        
        {fallbackMsg && (
          <div className="fallback-status">
             <span className="fallback-icon">🔄</span>
             {fallbackMsg}
          </div>
        )}

        <div className="loading-progress">
          <div className="loading-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-muted mt-8" style={{ fontSize: '11px' }}>
          Uploading heavy reports may take 10-30 seconds
        </div>
      </div>
    </div>
  );
}
