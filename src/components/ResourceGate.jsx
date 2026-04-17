import { useRef, useState } from 'react';

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Read detected columns from an uploaded CSV (first row)
async function detectColumns(file) {
  try {
    const text = await file.text();
    const firstLine = text.split('\n')[0];
    return firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Single Requirement Card
// ─────────────────────────────────────────────────────────────
function RequirementCard({ req, state, onUpload, onSkip, onRevert, fileInputRef }) {
  const isUploaded = state?.status === 'uploaded';
  const isSkipped  = state?.status === 'skipped';
  const isPending  = !isUploaded && !isSkipped;

  return (
    <div className={`rg-card ${isUploaded ? 'rg-card-uploaded' : isSkipped ? 'rg-card-skipped' : ''}`}>

      {/* Card header */}
      <div className="rg-card-header">
        <div className="rg-card-icon">
          {req.type === 'csv' ? '📊' : req.type === 'image' ? '🖼️' : '📄'}
        </div>
        <div className="rg-card-meta">
          <div className="rg-card-filename">{req.filename}</div>
          <div className="rg-card-badges">
            <span className={`rg-type-badge rg-type-${req.type}`}>
              {req.type === 'csv' ? 'CSV Dataset' : req.type === 'image' ? 'Image File' : 'File'}
            </span>
            {req.tasks_used?.length > 0 && (
              <span className="rg-tasks-badge">
                Used in Task{req.tasks_used.length > 1 ? 's' : ''} {req.tasks_used.join(', ')}
              </span>
            )}
          </div>
        </div>
        {isUploaded && <div className="rg-card-status-ok">✅</div>}
        {isSkipped  && <div className="rg-card-status-skip">🤖</div>}
      </div>

      {/* Description */}
      <p className="rg-card-desc">{req.description}</p>

      {/* CSV: required columns */}
      {req.type === 'csv' && req.required_columns?.length > 0 && (
        <div className="rg-columns">
          <div className="rg-columns-label">Required columns:</div>
          <div className="rg-columns-list">
            {req.required_columns.map(col => (
              <span key={col} className="rg-col-chip">{col}</span>
            ))}
          </div>
          {req.sample_size_hint && (
            <div className="rg-hint">💡 {req.sample_size_hint}</div>
          )}
        </div>
      )}

      {/* Image: expected type */}
      {req.type === 'image' && req.image_type && (
        <div className="rg-image-type">
          <span className="rg-image-type-label">Expected:</span> {req.image_type}
        </div>
      )}

      {/* Uploaded state */}
      {isUploaded && state.file && (
        <div className="rg-uploaded-info">
          <span className="rg-uploaded-name">📎 {state.file.name} ({formatBytes(state.file.size)})</span>
          {state.detectedColumns?.length > 0 && (
            <div className="rg-detected-cols">
              ✓ Detected {state.detectedColumns.length} columns: {state.detectedColumns.slice(0, 5).join(', ')}
              {state.detectedColumns.length > 5 ? ` +${state.detectedColumns.length - 5} more` : ''}
            </div>
          )}
          <button className="rg-btn-change" onClick={() => onRevert(req.id)}>
            ↩ Change file
          </button>
        </div>
      )}

      {/* Skipped state */}
      {isSkipped && (
        <div className="rg-skipped-info">
          🤖 Mock data will be auto-generated to simulate this file.
          <button className="rg-btn-change" onClick={() => onRevert(req.id)}>
            ↩ Upload instead
          </button>
        </div>
      )}

      {/* Actions — shown only when pending */}
      {isPending && (
        <div className="rg-card-actions">
          <button
            className="rg-btn-upload"
            onClick={() => fileInputRef?.current?.click()}
          >
            📂 Upload {req.filename}
          </button>
          {req.type !== 'image' && (
            <button className="rg-btn-skip" onClick={() => onSkip(req.id)}>
              🤖 Auto-generate mock
            </button>
          )}
          <input
            ref={el => { if (fileInputRef !== undefined) fileInputRef.current = el; }}
            type="file"
            style={{ display: 'none' }}
            accept={
              req.type === 'csv'   ? '.csv,.xlsx,.tsv' :
              req.type === 'image' ? 'image/*'         : '*'
            }
            onChange={e => onUpload(req, e.target.files[0])}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ResourceGate — main component
// ─────────────────────────────────────────────────────────────
export default function ResourceGate({ requirements, summary, onProceed, onSkipAll }) {
  const [resourceState, setResourceState] = useState(() => {
    const map = new Map();
    requirements.forEach(r => map.set(r.id, { status: 'pending' }));
    return map;
  });

  // One ref per requirement for the hidden file input
  const fileInputRefs = useRef({});

  const setStatus = (id, update) => {
    setResourceState(prev => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), ...update });
      return next;
    });
  };

  const handleUpload = async (req, file) => {
    if (!file) return;
    let detectedColumns = [];
    if (req.type === 'csv') {
      detectedColumns = await detectColumns(file);
    }
    setStatus(req.id, { status: 'uploaded', file, detectedColumns });
  };

  const handleSkip   = id => setStatus(id, { status: 'skipped', file: undefined });
  const handleRevert = id => {
    setStatus(id, { status: 'pending', file: undefined, detectedColumns: [] });
    if (fileInputRefs.current[id]) fileInputRefs.current[id].value = '';
  };

  const uploadedCount = [...resourceState.values()].filter(s => s.status === 'uploaded').length;
  const decidedCount  = [...resourceState.values()].filter(s => s.status !== 'pending').length;
  const allDecided    = decidedCount === requirements.length;
  const mockCount     = requirements.length - uploadedCount;

  const handleProceed = () => {
    const provided = [];
    const skipped  = [];
    requirements.forEach(req => {
      const state = resourceState.get(req.id);
      if (state?.status === 'uploaded') {
        provided.push({
          ...req,
          filename: state.file.name, // Use actual name of the uploaded file
          file: state.file,
          detectedColumns: state.detectedColumns || [],
        });
      } else {
        skipped.push(req);
      }
    });
    onProceed({ provided, skipped });
  };

  return (
    <div className="resource-gate">

      {/* Header */}
      <div className="rg-header">
        <div className="rg-header-icon">🔍</div>
        <div className="rg-header-text">
          <h2 className="rg-title">Lab Requirements Detected</h2>
          <p className="rg-summary">{summary}</p>
        </div>
      </div>

      {/* Progress strip */}
      <div className="rg-progress-wrap">
        <div className="rg-progress-track">
          <div
            className="rg-progress-bar"
            style={{ width: `${(decidedCount / requirements.length) * 100}%` }}
          />
        </div>
        <span className="rg-progress-label">
          {decidedCount === requirements.length
            ? `✅ All ${requirements.length} file${requirements.length !== 1 ? 's' : ''} decided`
            : `${decidedCount} / ${requirements.length} decided`}
        </span>
      </div>

      {/* Skip-all shortcut */}
      {requirements.every(r => r.type !== 'image') && (
        <div className="rg-skip-all-row">
          <span className="rg-skip-all-hint">Don't have any files?</span>
          <button
            className="rg-skip-all-btn"
            onClick={() => requirements.forEach(r => handleSkip(r.id))}
          >
            🤖 Auto-generate all mocks
          </button>
        </div>
      )}

      {/* Requirement cards */}
      <div className="rg-cards">
        {requirements.map(req => {
          // Create a stable ref object per req
          if (!fileInputRefs.current[req.id]) {
            fileInputRefs.current[req.id] = { current: null };
          }
          const refObj = fileInputRefs.current[req.id];

          return (
            <RequirementCard
              key={req.id}
              req={req}
              state={resourceState.get(req.id)}
              onUpload={handleUpload}
              onSkip={handleSkip}
              onRevert={handleRevert}
              fileInputRef={refObj}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="rg-footer">
        {!allDecided && (
          <p className="rg-footer-hint">
            👆 Upload or auto-generate a mock for each file above to continue
          </p>
        )}
        <button
          id="btn-proceed-solve"
          className={`rg-proceed-btn ${allDecided ? 'rg-proceed-ready' : ''}`}
          disabled={!allDecided}
          onClick={handleProceed}
        >
          {allDecided
            ? uploadedCount > 0
              ? `🚀 Solve with ${uploadedCount} real file${uploadedCount !== 1 ? 's' : ''}${mockCount > 0 ? ` + ${mockCount} mock${mockCount !== 1 ? 's' : ''}` : ''}`
              : `🚀 Solve with auto-generated mocks`
            : `⏳ Decide all files to continue (${decidedCount}/${requirements.length})`}
        </button>
      </div>
    </div>
  );
}
