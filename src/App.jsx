import { useState, useCallback, useEffect, useRef } from 'react';
import './index.css';
import ApiKeyInput from './components/ApiKeyInput';
import UploadZone from './components/UploadZone';
import LoadingScreen from './components/LoadingScreen';
import { solveLabReport } from './services/gemini';
import { solveLabReportOpenAI } from './services/openai';
import { downloadNotebook } from './services/notebook';
import { verifyAndFixAllTasks } from './services/executor';
import { refineLabTask, reVerifyDownstreamTasks } from './services/refiner';
import { analyzeLabRequirements } from './services/analyzer';
import ResourceGate from './components/ResourceGate';

// ─────────────────────────────────────────────────────────────
// TaskCell
// ─────────────────────────────────────────────────────────────
function TaskCell({ task, index, onRefine, isRefining, isCascading }) {
  const [open, setOpen]     = useState(true);
  const [copied, setCopied] = useState(false);

  // Derive status badge from executionStatus
  const statusInfo = (() => {
    const s = task.executionStatus;
    if (isRefining)                           return { text: '✨ Refining…',          cls: 'solving'  };
    if (isCascading)                          return { text: '🔄 Re-checking…',       cls: 'solving'  };
    if (!s || s === 'skipped')                return { text: '📖 Theoretical',         cls: 'ai-theory' };
    if (s === 'skipped_heavy_lib')            return { text: '⏭ Run in Colab',         cls: 'ai-theory' };
    if (s === 'success')                      return { text: '✅ Verified 1st Run',     cls: 'verified' };
    if (s?.startsWith('fixed_attempt'))       return { text: `✅ Fixed & Verified`,     cls: 'verified' };
    if (s === 'refined_verified')             return { text: '✅ Refined & Verified',   cls: 'verified' };
    if (s === 'refined_fixed')                return { text: '✅ Refined (auto-fixed)', cls: 'verified' };
    if (s === 'failed' || s === 'refined_failed') return { text: '⚠ Needs Review',    cls: 'error'    };
    return { text: '✓ Notebook Ready', cls: 'verified' };
  })();

  const displayCode = task.verifiedCode || task.code || '';

  function copy() {
    if (displayCode) {
      navigator.clipboard.writeText(displayCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <div
      className={`notebook-cell ${isRefining || isCascading ? 'active-refinement' : ''}`}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      {/* Header */}
      <div className="cell-header" onClick={() => setOpen(o => !o)}>
        <div className="cell-header-left">
          <div className="cell-number">{task.taskLabel || (index + 1)}</div>
          <div>
            <div className="cell-title">{task.title}</div>
            <div className="cell-subtitle">
              {task.hasCode ? '🐍 Python Code Block' : '📖 Theoretical Task'}
            </div>
          </div>
        </div>
        <div className="cell-status">
          <div className="status-badge-group">
            <span className={`status-badge ${statusInfo.cls}`}>{statusInfo.text}</span>
          </div>
          <span className={`cell-chevron ${open ? 'open' : ''}`}>▼</span>
        </div>
      </div>

      {/* Body */}
      <div className={`cell-body ${open ? 'expanded' : 'collapsed'}`}>

        {/* Description */}
        <div className="cell-section">
          <div className="section-label description">📝 Task Description</div>
          <div className="section-text">{task.description}</div>
        </div>

        {/* Solution */}
        <div className="cell-section">
          <div className="section-label solution">🔍 Solution</div>
          <div className="section-text">{task.solution}</div>
        </div>

        {/* Code */}
        {task.hasCode && displayCode && (
          <div className="cell-section">
            <div className="section-label output">💻 Python Code
              {task.verifiedCode && task.verifiedCode !== task.code && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent-green)', fontWeight: 400 }}>
                  (auto-corrected)
                </span>
              )}
            </div>
            <div className="code-block">
              <div className="code-block-header">
                <span className="code-lang">python</span>
                <button className="copy-btn" onClick={e => { e.stopPropagation(); copy(); }}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <pre>{displayCode}</pre>
            </div>
          </div>
        )}

        {/* Verified execution output */}
        {task.verifiedOutput && !task.verifiedOutput.startsWith('[Theoretical') && (
          <div className="cell-section">
            <div
              className="section-label output"
              style={{
                color: task.verifiedOutput.startsWith('[Execution Failed') ? '#ff5252'
                     : task.verifiedOutput.startsWith('[Execution Warning') ? '#f6ad55'
                     : '#4caf50',
              }}
            >
              ⚡ Execution Output
            </div>
            <pre
              className="section-text"
              style={{
                background: '#0a0e1a',
                color: task.verifiedOutput.startsWith('[Execution Failed') ? '#ff5252' : '#e2e8f0',
                padding: '12px 16px',
                borderRadius: 6,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 12.5,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {task.verifiedOutput}
            </pre>
          </div>
        )}

        {/* Output Analysis */}
        <div className="cell-section">
          <div className="section-label analysis">📊 Output Analysis</div>
          <div className="section-text">{task.outputAnalysis}</div>
        </div>

        {/* Refiner */}
        <div className="cell-section">
          <div className="section-label solution">✨ Refine This Task</div>
          <div className="refiner-chat">
            <RefinerForm
              onSubmit={prompt => onRefine(index, prompt)}
              disabled={isRefining || isCascading}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

function RefinerForm({ onSubmit, disabled }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <input
        type="text"
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="e.g. 'Use 100 epochs', 'Add confusion matrix', 'Fix the error'"
        disabled={disabled}
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onSubmit(val.trim()); setVal(''); } }}
        style={{
          flex: 1,
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          padding: '8px 12px',
          color: 'white',
          fontSize: '0.9rem',
        }}
      />
      <button
        disabled={disabled || !val.trim()}
        onClick={() => { if (val.trim()) { onSubmit(val.trim()); setVal(''); } }}
        style={{
          padding: '8px 16px',
          background: 'linear-gradient(135deg,#6366f1,#818cf8)',
          border: 'none',
          borderRadius: 8,
          color: 'white',
          fontWeight: 600,
          cursor: disabled || !val.trim() ? 'not-allowed' : 'pointer',
          opacity: disabled || !val.trim() ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {disabled ? '⌛ Refining…' : '✨ Update'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ResultsView
// ─────────────────────────────────────────────────────────────
function ResultsView({ labData, onReset, onDownload, onRefine, refiningTaskId, cascadingTaskIds }) {
  const verifiedCount = labData.tasks?.filter(
    t => t.executionStatus && !t.executionStatus.startsWith('skip') && !t.executionStatus.startsWith('refined_unverified')
  ).length || 0;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>

      <div className="results-header">
        <div>
          <div className="results-title">
            <span>{labData.reportTitle || 'Lab Report'}</span>
          </div>
          <div className="results-meta">
            {labData.subject && <span>📚 {labData.subject} · </span>}
            <span>✅ {labData.tasks?.length || 0} tasks · </span>
            <span>⚡ {verifiedCount} execution-verified</span>
            {labData.mockDataCode && <span> · 🗂 Mock data included</span>}
          </div>
        </div>
        <div className="results-actions">
          <button className="btn-outline" onClick={onReset}>🔄 New Report</button>
          <button className="btn-primary-sm" onClick={onDownload}>📥 Download .ipynb</button>
        </div>
      </div>

      {/* Mock data preview */}
      {labData.mockDataCode && (
        <div className="notebook-cell" style={{ marginBottom: 24, borderColor: 'rgba(56,178,172,0.35)' }}>
          <div className="cell-header" style={{ cursor: 'default' }}>
            <div className="cell-header-left">
              <div className="cell-number" style={{ background: 'linear-gradient(135deg,#38b2ac,#4fd1c5)' }}>0</div>
              <div>
                <div className="cell-title">Mock Data Setup</div>
                <div className="cell-subtitle">🗂 Auto-generated dataset — Cell 0 in notebook</div>
              </div>
            </div>
            <span className="status-badge verified">✅ Injected</span>
          </div>
          <div className="cell-body expanded">
            <div className="cell-section">
              <div className="section-label" style={{ color: 'var(--accent-teal)' }}>🗂 Mock Data Code</div>
              <div className="code-block">
                <div className="code-block-header">
                  <span className="code-lang">python</span>
                </div>
                <pre style={{ maxHeight: 240, overflow: 'auto' }}>{labData.mockDataCode}</pre>
              </div>
            </div>
            {labData.mockDataOutput && (
              <div className="cell-section">
                <div className="section-label" style={{ color: 'var(--accent-green)' }}>⚡ Output</div>
                <pre className="section-text" style={{ background: '#0a0e1a', color: '#e2e8f0', padding: '10px 14px', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
                  {labData.mockDataOutput}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task cells */}
      {(!labData.tasks || labData.tasks.length === 0) && (
        <div className="error-card notebook-cell" style={{ margin: '20px 0' }}>
          <strong>AI Diagnostic Output (0 Tasks Detected)</strong>
          <p>The file was processed but no lab tasks were found.</p>
          <pre style={{ textAlign: 'left', background: '#000', padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 300, color: '#0f0', borderRadius: 4 }}>
            {JSON.stringify(labData, null, 2)}
          </pre>
        </div>
      )}

      {labData.tasks?.map((task, i) => (
        <TaskCell
          key={`${task.taskNumber}-${i}`}
          task={task}
          index={i}
          onRefine={onRefine}
          isRefining={refiningTaskId === i}
          isCascading={cascadingTaskIds?.has(i)}
        />
      ))}

      {/* Conclusion */}
      {labData.conclusion && (
        <div className="conclusion-block">
          <div className="conclusion-header">
            <div className="conclusion-icon">📋</div>
            <div>
              <div className="conclusion-title">Conclusion</div>
              <div className="conclusion-subtitle">AI-generated summary</div>
            </div>
          </div>
          <div className="conclusion-text">{labData.conclusion}</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────
const PHASE = {
  IDLE:              'idle',
  ANALYZING:         'analyzing',
  AWAITING_RESOURCES:'awaiting_resources',
  SOLVING:           'solving',
  EXECUTING:         'executing',
  DONE:              'done',
  ERROR:             'error',
};

export default function App() {
  const [apiKey,              setApiKeyRaw]       = useState(() => localStorage.getItem('gemini_api_key')  || '');
  const [openaiKey,           setOpenaiKeyRaw]    = useState(() => localStorage.getItem('openai_api_key') || '');
  const [provider,            setProvider]        = useState(() => localStorage.getItem('ls_provider')    || 'gemini');
  const [preferredModel,      setPreferredModel]  = useState('gemini-2.5-flash');
  const [preferredModelOpenAI, setPreferredModelOpenAI] = useState(() => localStorage.getItem('ls_openai_model') || 'gpt-4o');

  const [file,            setFile]        = useState(null);
  const [datasets,        setDatasets]    = useState([]);
  const [phase,           setPhase]       = useState(PHASE.IDLE);
  const [progress,        setProgress]    = useState(0);
  const [statusMsg,       setStatusMsg]   = useState('');
  const [labData,         setLabData]     = useState(null);
  const [error,           setError]       = useState('');
  const [activeModel,     setActiveModel] = useState('');
  const [refiningTaskId,  setRefiningTaskId]   = useState(null);
  const [cascadingTaskIds, setCascadingTaskIds] = useState(null);
  const [retryTimer,      setRetryTimer]  = useState(0);
  const [autoRetry,       setAutoRetry]   = useState(true);
  // Smart resource detection
  const [requirements,    setRequirements]   = useState([]);
  const [reqSummary,      setReqSummary]     = useState('');
  const [resourceContext, setResourceContext] = useState(null); // { provided, skipped }
  const retryCountRef = useRef(0);

  function handleSetApiKey(k)      { setApiKeyRaw(k);    localStorage.setItem('gemini_api_key',  k); }
  function handleSetOpenaiKey(k)   { setOpenaiKeyRaw(k); localStorage.setItem('openai_api_key',  k); }
  function handleSetProvider(p)    { setProvider(p);     localStorage.setItem('ls_provider',     p); }

  useEffect(() => { localStorage.setItem('ls_openai_model', preferredModelOpenAI); }, [preferredModelOpenAI]);

  // ── Main solve pipeline ──────────────────────────────────
  const handleSolve = useCallback(async (isAuto = false, immediateCtx = null) => {
    const currentKey = (provider === 'gemini' ? apiKey : openaiKey).trim();
    if (currentKey.length < 10 || !file) return;

    if (isAuto) {
      if (retryCountRef.current >= 3) {
        setError('Maximum retries reached. Please wait a few minutes then try again.');
        setPhase(PHASE.ERROR);
        setRetryTimer(0);
        return;
      }
      retryCountRef.current += 1;
    } else {
      retryCountRef.current = 0;
    }

    setPhase(PHASE.SOLVING);
    setProgress(0);
    setError('');
    setLabData(null);
    setStatusMsg('Analyzing lab report…');

    // Use provided ctx if available, otherwise fallback to state
    const providedFiles = (immediateCtx?.provided || resourceContext?.provided || []);

    const availableFilenames = providedFiles.length > 0 
      ? providedFiles.map(f => f.filename)
      : (datasets || []).map(d => d.filename);

    const extraContext = availableFilenames.length > 0
      ? `\nCRITICAL: The following external files (and ONLY these files) are available in the current directory: ${availableFilenames.join(', ')}. You MUST use these exact filenames (including extensions) in your code (e.g., pd.read_csv, plt.imread, cv2.imread).`
      : '';

    const model = provider === 'gemini' ? preferredModel : preferredModelOpenAI;
    setActiveModel(model);

    try {
      // ── Phase 1: AI solves the lab report ─────────────────
      setStatusMsg('AI is analyzing and solving the lab report…');
      let data;
      if (provider === 'gemini') {
        data = await solveLabReport(file, apiKey.trim(), p => setProgress(Math.round(p * 0.4)), preferredModel, extraContext);
      } else {
        data = await solveLabReportOpenAI(file, openaiKey.trim(), p => setProgress(Math.round(p * 0.4)), preferredModelOpenAI, extraContext);
      }

      setProgress(40);

      // ── Phase 2: Verify + fix each code cell ──────────────
      setPhase(PHASE.EXECUTING);
      setStatusMsg('Loading Python runtime…');

      const totalTasks   = data.tasks?.length || 1;
      let   completedTasks = 0;

      const verifiedData = await verifyAndFixAllTasks(
        data,
        provider,
        currentKey,
        model,
        (msg) => setStatusMsg(msg),
        (_i, _task) => {
          completedTasks++;
          setProgress(40 + Math.round((completedTasks / totalTasks) * 55));
        },
        providedFiles
      );

      // ── Phase 3: Done ──────────────────────────────────────
      setLabData(verifiedData);
      setProgress(100);
      setPhase(PHASE.DONE);

    } catch (err) {
      const msg = err.message || 'An unexpected error occurred.';
      setError(msg);
      setPhase(PHASE.ERROR);

      // Auto-retry on quota errors
      if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
        setRetryTimer(60);
      }
    }

  }, [file, apiKey, openaiKey, datasets, provider, preferredModel, preferredModelOpenAI, resourceContext]);

  // ── Retry countdown ──────────────────────────────────────
  useEffect(() => {
    if (retryTimer <= 0) return;
    const id = setInterval(() => {
      setRetryTimer(t => {
        if (t <= 1) {
          clearInterval(id);
          if (autoRetry) handleSolve(true, resourceContext);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryTimer, autoRetry, handleSolve, resourceContext]);

  // ── Step 1: Analyze lab requirements ────────────────
  const handleAnalyze = async () => {
    const currentKey = (provider === 'gemini' ? apiKey : openaiKey).trim();
    if (currentKey.length < 10 || !file) return;
    setPhase(PHASE.ANALYZING);
    setError('');
    try {
      const model = provider === 'gemini' ? preferredModel : preferredModelOpenAI;
      const result = await analyzeLabRequirements(file, provider, currentKey, model);
      if (!result.hasRequirements || result.requirements.length === 0) {
        // No external files needed — skip straight to solve
        setResourceContext(null);
        await handleSolve(false, null);
      } else {
        setRequirements(result.requirements);
        setReqSummary(result.summary || '');
        setPhase(PHASE.AWAITING_RESOURCES);
      }
    } catch (err) {
      setError(`Analysis failed: ${err.message}`);
      setPhase(PHASE.ERROR);
    }
  };

  // ── Step 2: User decided on resources ───────────────
  const handleProceedWithResources = (ctx) => {
    setResourceContext(ctx);
    handleSolve(false, ctx);
  };

  // ── Manual task refinement ───────────────────────────────
  const handleRefineTask = async (index, instruction) => {
    if (!labData) return;
    setRefiningTaskId(index);
    try {
      const task    = labData.tasks[index];
      const updated = await refineLabTask(
        index,
        task,
        instruction,
        labData.tasks,
        labData,
        provider,
        provider === 'gemini' ? apiKey.trim() : openaiKey.trim(),
        provider === 'gemini' ? preferredModel : preferredModelOpenAI,
        resourceContext?.provided || []
      );

      // Immediately update the refined task in state
      let newTasks = [...labData.tasks];
      newTasks[index] = updated;
      setLabData(prev => ({ ...prev, tasks: newTasks }));
      setRefiningTaskId(null);

      // If there are downstream tasks, cascade-verify them
      const hasDownstream = index < labData.tasks.length - 1;
      if (hasDownstream) {
        const downstreamIndices = new Set(
          Array.from({ length: newTasks.length - index - 1 }, (_, k) => index + 1 + k)
        );
        setCascadingTaskIds(downstreamIndices);

        const currentKey = provider === 'gemini' ? apiKey.trim() : openaiKey.trim();
        const model      = provider === 'gemini' ? preferredModel : preferredModelOpenAI;

        const cascadedTasks = await reVerifyDownstreamTasks(
          newTasks,
          { ...labData, tasks: newTasks },
          index,
          provider,
          currentKey,
          model,
          (taskIdx, taskResult) => {
            // Update each task as it finishes
            setCascadingTaskIds(prev => {
              const next = new Set(prev);
              next.delete(taskIdx);
              return next.size > 0 ? next : null;
            });
            setLabData(prev => {
              if (!prev) return prev;
              const t = [...prev.tasks];
              t[taskIdx] = taskResult;
              return { ...prev, tasks: t };
            });
          },
          resourceContext?.provided || []
        );

        // Final state sync with fully cascaded tasks
        setLabData(prev => prev ? { ...prev, tasks: cascadedTasks } : prev);
        setCascadingTaskIds(null);
      }
    } catch (err) {
      setError(`Refinement failed: ${err.message}`);
    } finally {
      setRefiningTaskId(null);
      setCascadingTaskIds(null);
    }
  };

  const handleReset    = () => {
    setPhase(PHASE.IDLE); setProgress(0); setLabData(null);
    setError(''); setFile(null); setRequirements([]); setResourceContext(null);
  };
  const handleDownload = () => { if (labData) downloadNotebook(labData); };

  const isLoading   = phase === PHASE.SOLVING || phase === PHASE.EXECUTING;
  const currentKey  = (provider === 'gemini' ? apiKey : openaiKey).trim();
  const canAnalyze  = currentKey.length >= 10 && !!file && phase === PHASE.IDLE;
  const loadingTitle = phase === PHASE.EXECUTING ? 'Verifying & Fixing Code…' : 'Solving Lab Report…';

  return (
    <div className="app-wrapper">
      <div className="bg-blobs" />

      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">🔬</div>
            <div>
              <div className="logo-text">Lab Solver AI</div>
              <div className="logo-sub">
                {phase === PHASE.DONE
                  ? `Solved with ${activeModel}`
                  : 'Powered by Gemini 2.5 / GPT-4o'}
              </div>
            </div>
          </div>
          <div className="header-badge">
            <div className="dot-pulse" />
            AI Active
          </div>
        </div>
      </header>

      {isLoading && (
        <LoadingScreen
          progress={progress}
          statusOverride={loadingTitle}
          fallbackMsg={statusMsg}
        />
      )}

      {/* Results + Phase Screens */}
      {phase === PHASE.DONE && labData ? (
        <ResultsView
          labData={labData}
          onReset={handleReset}
          onDownload={handleDownload}
          onRefine={handleRefineTask}
          refiningTaskId={refiningTaskId}
          cascadingTaskIds={cascadingTaskIds}
        />
      ) : phase === PHASE.AWAITING_RESOURCES ? (
        <main style={{ flex: 1 }}>
          <ResourceGate
            requirements={requirements}
            summary={reqSummary}
            onProceed={handleProceedWithResources}
          />
        </main>
      ) : phase === PHASE.ANALYZING ? (
        <main style={{ flex: 1 }}>
          <div className="container">
            <div className="analyzing-card">
              <span className="analyzing-icon">🔍</span>
              <div className="analyzing-title">Scanning Lab Report…</div>
              <p className="analyzing-sub">
                Detecting required files — datasets, images, and resources
                needed by your lab. This takes just a few seconds.
              </p>
            </div>
          </div>
        </main>
      ) : (
        <main style={{ flex: 1 }}>
          <div className="hero">
            <div className="container">
              <h1>
                Solve Any Lab Report<br />
                <span>Instantly with AI</span>
              </h1>
              <p>
                Upload your lab report — AI detects required files, asks you to
                provide them, then solves every task with verified Python code.
              </p>
            </div>
          </div>

          <div className="container">
            {/* Error card */}
            {phase === PHASE.ERROR && (
              <div className="error-card">
                <div className="error-icon">⚠️</div>
                <div>
                  <div className="error-title">Something went wrong</div>
                  <div className="error-msg">{error}</div>
                  {retryTimer > 0 && (
                    <div style={{ margin: '12px 0', color: 'var(--accent-teal)', fontSize: 14, fontWeight: 600 }}>
                      ⏳ {autoRetry ? 'Auto-retrying' : 'Recommended wait'}: <strong>{retryTimer}s</strong>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
                    <button className="retry-btn" onClick={() => handleAnalyze()} disabled={retryTimer > 0}>
                      {retryTimer > 0 ? `Wait ${retryTimer}s` : 'Try Again'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={autoRetry} onChange={e => setAutoRetry(e.target.checked)} />
                      Auto-retry on quota errors
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="upload-panel">
              <div className="config-header">
                <div className="config-title">⚙️ Configuration</div>
                <div className="config-hint">Settings saved locally</div>
              </div>

              <div className="provider-tabs">
                <button className={`tab-item ${provider === 'gemini' ? 'active' : ''}`} onClick={() => handleSetProvider('gemini')}>
                  ✨ Gemini
                </button>
                <button className={`tab-item ${provider === 'openai' ? 'active' : ''}`} onClick={() => handleSetProvider('openai')}>
                  🚀 OpenAI
                </button>
              </div>

              <ApiKeyInput
                apiKey={provider === 'gemini' ? apiKey : openaiKey}
                setApiKey={provider === 'gemini' ? handleSetApiKey : handleSetOpenaiKey}
                provider={provider}
              />

              <div className="model-selector">
                <div className="model-selector-label">
                  {provider === 'gemini' ? 'Gemini Model' : 'OpenAI Model'}
                </div>
                {provider === 'gemini' ? (
                  <select className="model-select" value={preferredModel} onChange={e => setPreferredModel(e.target.value)}>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Powerful)</option>
                  </select>
                ) : (
                  <select className="model-select" value={preferredModelOpenAI} onChange={e => setPreferredModelOpenAI(e.target.value)}>
                    <option value="gpt-4o">GPT-4o (Recommended)</option>
                    <option value="gpt-4o-mini">GPT-4o-mini (Faster)</option>
                  </select>
                )}
                <div className="model-hint">Code is execution-verified in browser before notebook export</div>
              </div>

              <UploadZone file={file} setFile={setFile} datasets={datasets} setDatasets={setDatasets} />

              <button
                id="btn-analyze"
                className="analyze-btn"
                disabled={!canAnalyze}
                onClick={handleAnalyze}
              >
                <span>🔍</span> Analyze Lab &amp; Detect Requirements
              </button>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 48 }}>
              {[
                ['⚡', 'Verified Code Execution'],
                ['🔍', 'Smart File Detection'],
                ['🗂', 'Auto Mock Datasets'],
                ['🔁', 'Auto-Fix Up to 3×'],
                ['📥', 'Jupyter Notebook Export'],
                ['🔒', 'Client-Side Only'],
              ].map(([icon, label]) => (
                <div key={label} className="badge" style={{ padding: '6px 16px', fontSize: 13 }}>
                  {icon} {label}
                </div>
              ))}
            </div>
          </div>
        </main>

      )}

      <footer className="footer">
        <div className="container">
          Lab Solver AI · Verified execution · Mock data · Auto-fix · Your files never leave your browser
        </div>
      </footer>
    </div>
  );
}
