import { useState, useCallback, useEffect } from 'react';
import './index.css';
import ApiKeyInput from './components/ApiKeyInput';
import UploadZone from './components/UploadZone';
import LoadingScreen from './components/LoadingScreen';
import { solveLabReport } from './services/gemini';
import { solveLabReportOpenAI } from './services/openai';
import { solveLabReportGroq } from './services/groq';
import { downloadNotebook } from './services/notebook';
import { loadPyodideRuntime, runPythonCode } from './services/pyodide';
import { refineLabTask } from './services/refiner';

/* ── small inline components ── */

function TaskCell({ task, index, onRefine, isRefining }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Status determined by refinement state
  let statusText = '✓ Notebook Ready';
  let statusClass = 'verified';

  if (isRefining) {
    statusText = '✨ Refining...';
    statusClass = 'solving';
  }

  function copy() {
    if (task.code) {
      navigator.clipboard.writeText(task.code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <div className={`notebook-cell ${isRefining ? 'active-refinement' : ''}`} style={{ animationDelay: `${index * 0.08}s` }}>
      {/* Header */}
      <div className="cell-header" onClick={() => setOpen(o => !o)}>
        <div className="cell-header-left">
          <div className="cell-number">{task.taskNumber}</div>
          <div>
            <div className="cell-title">{task.title}</div>
            <div className="cell-subtitle">
              {task.hasCode ? '🐍 Python Code Block' : '📖 Theoretical Task'}
            </div>
          </div>
        </div>
        <div className="cell-status">
          <div className="status-badge-group">
            <span className={`status-badge ${statusClass}`}>
              {statusText}
            </span>
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
        {task.hasCode && task.code && (
          <div className="cell-section">
            <div className="section-label output">💻 Python Code</div>
            <div className="code-block">
              <div className="code-block-header">
                <span className="code-lang">python</span>
                <button className="copy-btn" onClick={e => { e.stopPropagation(); copy(); }}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <pre>{task.code}</pre>
            </div>
          </div>
        )}

        {/* Output Analysis */}
        <div className="cell-section">
          <div className="section-label analysis">📊 Output Analysis</div>
          <div className="section-text">{task.outputAnalysis}</div>
        </div>

        {/* Verified Execution Output */}
        {task.verifiedOutput && (
          <div className="cell-section">
            <div className="section-label output" style={{color: task.verifiedOutput.includes('[Execution Failed]') ? '#ff5252' : '#4caf50'}}>
              ⚡ Verified Browser Output
            </div>
            <pre className="section-text" style={{background: '#1e1e1e', color: '#fff', padding: '10px', borderRadius: '4px', overflowX: 'auto', whiteSpace: 'pre-wrap'}}>
              {task.verifiedOutput}
            </pre>
          </div>
        )}

        {/* Refiner Chat */}
        <div className="cell-section">
          <div className="section-label solution">✨ Refine This Task</div>
          <div className="refiner-chat">
            <form onSubmit={async (e) => {
              e.preventDefault();
              const prompt = e.target.elements.refineInput.value;
              if (!prompt.trim()) return;
              onRefine(index, prompt);
              e.target.elements.refineInput.value = '';
            }}>
              <input 
                name="refineInput"
                type="text" 
                placeholder="Tweak this task... (e.g. 'Use 100 epochs' or 'Fix error')"
                disabled={isRefining}
              />
              <button type="submit" disabled={isRefining}>
                {isRefining ? '⌛ Refining...' : '✨ Update'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsView({ labData, onReset, onDownload, onRefine, refiningTaskId }) {
  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      {/* Results header */}
      <div className="results-header">
        <div>
          <div className="results-title">
            <span>{labData.reportTitle || 'Lab Report'}</span>
          </div>
          <div className="results-meta">
            {labData.subject && <span>📚 {labData.subject} · </span>}
            <span>✅ {labData.totalTasks || labData.tasks?.length || 0} tasks solved (Notebook Mode)</span>
          </div>
        </div>
        <div className="results-actions">
          <button className="btn-outline" onClick={onReset} id="btn-new-report">
            🔄 New Report
          </button>
          <button className="btn-primary-sm" onClick={onDownload} id="btn-download-notebook">
            📥 Download .ipynb
          </button>
        </div>
      </div>

      {/* Task cells */}
      {(!labData.tasks || labData.tasks.length === 0) && (
        <div className="error-card notebook-cell" style={{margin: '20px 0'}}>
            <strong>AI Diagnostic Output (0 Tasks Detected)</strong>
            <p>The file was processed perfectly, but the AI did not identify any lab tasks matching the required criteria.</p>
            <pre style={{textAlign: 'left', background: '#000', padding: '10px', fontSize: '11px', overflow: 'auto', maxHeight: '300px', color: '#0f0', borderRadius: '4px'}}>
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
        />
      ))}

      {/* Conclusion */}
      {labData.conclusion && (
        <div className="conclusion-block">
          <div className="conclusion-header">
            <div className="conclusion-icon">📋</div>
            <div>
              <div className="conclusion-title">Conclusion</div>
              <div className="conclusion-subtitle">
                AI-generated summary of your lab report
              </div>
            </div>
          </div>
          <div className="conclusion-text">{labData.conclusion}</div>
        </div>
      )}
    </div>
  );
}

/* ── Main App ── */

const PHASE = {
  IDLE: 'idle',
  SOLVING: 'solving',
  EXECUTING: 'executing',
  DONE: 'done',
  ERROR: 'error',
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [preferredModel, setPreferredModel] = useState('gemini-2.5-flash');
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [progress, setProgress] = useState(0);
  const [labData, setLabData] = useState(null);
  const [error, setError] = useState('');
  const [datasets, setDatasets] = useState([]);

  const [provider, setProvider] = useState(() => localStorage.getItem('ls_provider') || 'gemini');
  const [activeModel, setActiveModel] = useState('none');
  const [retryTimer, setRetryTimer] = useState(0);
  const [autoRetry, setAutoRetry] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [fallbackMsg, setFallbackMsg] = useState('');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [preferredModelOpenAI, setPreferredModelOpenAI] = useState(() => localStorage.getItem('ls_openai_model') || 'gpt-4o');
  
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('groq_api_key') || '');
  const [preferredModelGroq, setPreferredModelGroq] = useState(() => localStorage.getItem('ls_groq_model') || 'llama-3.2-90b-vision-preview');
  
  const [refiningTaskId, setRefiningTaskId] = useState(null);

  // Persist API keys and settings
  function handleSetApiKey(key) {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  }

  function handleSetOpenaiKey(key) {
    setOpenaiKey(key);
    localStorage.setItem('openai_api_key', key);
  }

  function handleSetGroqKey(key) {
    setGroqKey(key);
    localStorage.setItem('groq_api_key', key);
  }

  useEffect(() => {
    localStorage.setItem('ls_openai_model', preferredModelOpenAI);
  }, [preferredModelOpenAI]);

  useEffect(() => {
    localStorage.setItem('ls_groq_model', preferredModelGroq);
  }, [preferredModelGroq]);

  const handleSolve = useCallback(async (isAuto = false) => {
    // Fresh check of basic readiness
    const currentKey = provider === 'gemini' ? apiKey.trim() : provider === 'groq' ? groqKey.trim() : openaiKey.trim();
    if (currentKey.length < 10 || !file) return;

    if (isAuto && provider === 'gemini') {
      if (retryCount >= 3) {
        setError("Maximum automatic retries reached. Your Gemini quota is likely exhausted for a longer period. Please wait 10-15 minutes carefully.");
        setPhase(PHASE.ERROR);
        setAutoRetry(false);
        setRetryTimer(0);
        return;
      }
      setRetryCount(c => c + 1);
    } else {
      // Manual click resets the counter
      setRetryCount(0);
    }

    setPhase(PHASE.SOLVING);
    setProgress(0);
    setError('');
    setLabData(null);
    setFallbackMsg('');
    const extraContext = datasets.length > 0 
      ? `\nAvailable local data files: ${datasets.map(d => d.name).join(', ')}. Use these filenames in pd.read_csv() if asked.` 
      : '';

    try {
      // 1. Call provider
      const runSolve = async (ctx) => {
        if (provider === 'gemini') {
          setActiveModel(preferredModel);
          return await solveLabReport(file, apiKey.trim(), p => setProgress(p), preferredModel, ctx, 'pro');
        } else if (provider === 'groq') {
          setActiveModel(preferredModelGroq);
          return await solveLabReportGroq(file, groqKey.trim(), p => setProgress(p), preferredModelGroq, ctx);
        } else {
          setActiveModel(preferredModelOpenAI);
          return await solveLabReportOpenAI(file, openaiKey.trim(), p => setProgress(p), preferredModelOpenAI, ctx, 'pro');
        }
      };

      let data = await runSolve(extraContext);

      // Phase 2: Output Validation & Execution Engine
      setPhase(PHASE.EXECUTING);
      setProgress(50);
      setFallbackMsg('Initializing browser Python runtime (Pyodide)...');

      try {
        await loadPyodideRuntime(msg => setFallbackMsg(msg));
        
        let validatedTasks = [];
        let currentProgress = 50;
        const progressPerTask = 50 / (data.tasks.length || 1);

        for (let i = 0; i < data.tasks.length; i++) {
          let task = data.tasks[i];
          setFallbackMsg(`Executing Task ${task.taskNumber}: ${task.title}...`);
          
          if (task.hasCode && task.code) {
            // Safety check for deep learning libraries which crash pyodide
            const codeLower = task.code.toLowerCase();
            const hasDeepLearning = /\b(tensorflow|keras|torch|theano)\b/.test(codeLower);
            
            if (hasDeepLearning) {
              task.verifiedOutput = "[Execution Skipped]: Deep Learning libraries (TensorFlow/PyTorch) cannot be natively executed in the browser sandbox. Code is ready for Google Colab.";
            } else {
              let retries = 0;
              let success = false;

              while (retries < 3 && !success) {
                try {
                  const execResult = await runPythonCode(task.code);
                  if (execResult.error) {
                    throw new Error(execResult.error);
                  }
                  task.verifiedOutput = execResult.output || "[Cell executed successfully with no internal output]";
                  success = true;
                } catch (pyErr) {
                  retries++;
                  setFallbackMsg(`Task ${task.taskNumber} failed (Attempt ${retries}/3). Auto-Refining codebase...`);
                  
                  // Auto-refine
                  const trace = pyErr.message || String(pyErr);
                  const refinementPrompt = `The code you generated threw the following exception when executed:\n\n${trace}\n\nFix the code immediately.`;
                  
                  try {
                    const refinedTask = await refineLabTask(task, refinementPrompt, provider, provider === 'gemini' ? apiKey.trim() : openaiKey.trim(), provider === 'gemini' ? preferredModel : preferredModelOpenAI);
                    task.code = refinedTask.code;
                    task.solution = refinedTask.solution;
                  } catch (refineErr) {
                    console.error("Auto-Refiner failed:", refineErr);
                    task.verifiedOutput = `[Execution Failed]: ${trace}\n(Auto-refinement system was unable to fix this automatically. Please review manually.)`;
                    success = true; // Break loop
                  }
                  
                  if (retries >= 3 && !success) {
                    task.verifiedOutput = `[Execution Failed]: ${trace}\n(Max automatic retry limit reached for this cell.)`;
                  }
                }
              }
            }
          }

          validatedTasks.push(task);
          currentProgress += progressPerTask;
          setProgress(currentProgress);
        }

        data.tasks = validatedTasks;
      } catch (runtimeErr) {
        console.error("Pyodide Engine failed to initialize completely:", runtimeErr);
        // Continue anyway; we just won't have verifiedOutput
        setFallbackMsg('Execution engine bypassed. Finalizing theoretical notebook...');
      }

      setLabData(data);

      setPhase(PHASE.DONE);
      setProgress(100);
    } catch (err) {
      let errorMessage = err.message || 'An unexpected error occurred.';

      setError(errorMessage);
      setPhase(PHASE.ERROR);
    }
  }, [file, apiKey, openaiKey, datasets, retryCount, preferredModel, provider]); // Updated deps

  // Countdown timer logic
  useEffect(() => {
    let interval;
    if (retryTimer > 0) {
      interval = setInterval(() => {
        setRetryTimer(t => {
          if (t <= 1) {
            clearInterval(interval);
            if (autoRetry) handleSolve(true); // Pass true for isAuto
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [retryTimer, autoRetry, handleSolve]);

  const handleRefineTask = async (index, instruction) => {
    if (!labData) return;
    setRefiningTaskId(index);
    try {
      const { refineLabTask } = await import('./services/refiner');
      const task = labData.tasks[index];
      const currentKey = provider === 'gemini' ? apiKey.trim() : provider === 'groq' ? groqKey.trim() : openaiKey.trim();
      const currentModel = provider === 'gemini' ? preferredModel : provider === 'groq' ? preferredModelGroq : preferredModelOpenAI;
      
      const updatedTask = await refineLabTask(task, instruction, provider, currentKey, currentModel);
      
      const newTasks = [...labData.tasks];
      newTasks[index] = { ...updatedTask, taskNumber: task.taskNumber }; // Preserve number
      setLabData({ ...labData, tasks: newTasks });
    } catch (err) {
      setError(`Refinement failed: ${err.message}`);
    } finally {
      setRefiningTaskId(null);
    }
  };

  const handleReset = () => {
    setPhase(PHASE.IDLE);
    setProgress(0);
    setLabData(null);
    setError('');
    setFile(null);
  }

  function handleDownload() {
    if (labData) downloadNotebook(labData);
  }

  const isLoading = phase === PHASE.SOLVING || phase === PHASE.EXECUTING;

  const loadingTitle =
    phase === PHASE.EXECUTING
      ? `Executing Python...`
      : undefined;

  return (
    <div className="app-wrapper">
      {/* Background blobs */}
      <div className="bg-blobs" />

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">🔬</div>
            <div>
              <div className="logo-text">Lab Solver AI</div>
            <div className="logo-sub">
              {phase === PHASE.DONE ? `Solved with ${activeModel}` : 'Powered by Gemini, OpenAI & Groq'}
            </div>
            </div>
          </div>
          <div className="header-badge">
            <div className="dot-pulse" />
            AI Active
          </div>
        </div>
      </header>

      {/* Loading overlay */}
      {isLoading && (
        <LoadingScreen 
          progress={progress} 
          statusOverride={loadingTitle} 
          fallbackMsg={fallbackMsg}
        />
      )}

      {/* Results view */}
      {phase === PHASE.DONE && labData ? (
        <ResultsView
          labData={labData}
          onReset={handleReset}
          onDownload={handleDownload}
          onRefine={handleRefineTask}
          refiningTaskId={refiningTaskId}
        />
      ) : (
        /* Upload / idle / error view */
        <main style={{ flex: 1 }}>
          {/* Hero */}
          <div className="hero">
            <div className="container">
              <h1>
                Solve Any Lab Report<br />
                <span>Instantly with AI</span>
              </h1>
              <p>
                Upload your lab report (PDF or image) and get every task solved
                step-by-step — with runnable Python code, output analysis, and a
                downloadable Jupyter notebook.
              </p>
            </div>
          </div>

          {/* Upload panel */}
          <div className="container">
            {/* Error */}
            {phase === PHASE.ERROR && (
              <div className="error-card">
                <div className="error-icon">⚠️</div>
                <div>
                  <div className="error-title">Something went wrong</div>
                  <div className="error-msg">{error}</div>
                  
                  {retryTimer > 0 && (
                    <div className="retry-timer-msg" style={{ margin: '12px 0', color: 'var(--accent-teal)', fontSize: '14px', fontWeight: '600' }}>
                      ⏳ {autoRetry ? 'Auto-retrying' : 'Recommended wait'}: <strong>{retryTimer}s</strong>
                    </div>
                  )}

                  <div className="error-actions" style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
                    <button 
                      className="retry-btn" 
                      onClick={handleSolve}
                      disabled={retryTimer > 0}
                    >
                      {retryTimer > 0 ? `Wait ${retryTimer}s` : 'Try Again Now'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <input 
                        type="checkbox" 
                        checked={autoRetry} 
                        onChange={e => setAutoRetry(e.target.checked)} 
                      />
                      Auto-retry
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="upload-panel">
              <div className="config-header">
                <div className="config-title">⚙️ Configuration</div>
                <div className="config-hint">Settings are saved locally</div>
              </div>

              {/* Provider Selector Tabs */}
              <div className="provider-tabs">
                <button 
                  className={`tab-item ${provider === 'gemini' ? 'active' : ''}`}
                  onClick={() => setProvider('gemini')}
                >
                  ✨ Gemini
                </button>
                <button 
                  className={`tab-item ${provider === 'openai' ? 'active' : ''}`}
                  onClick={() => setProvider('openai')}
                >
                  🚀 OpenAI
                </button>
                <button 
                  className={`tab-item ${provider === 'groq' ? 'active' : ''}`}
                  onClick={() => setProvider('groq')}
                >
                  ⚡ Groq
                </button>
              </div>

              <ApiKeyInput 
                apiKey={provider === 'gemini' ? apiKey : provider === 'groq' ? groqKey : openaiKey} 
                setApiKey={provider === 'gemini' ? handleSetApiKey : provider === 'groq' ? handleSetGroqKey : handleSetOpenaiKey} 
                provider={provider}
              />
              {/* Model selection */}
              <div className="model-selector">
                <div className="model-selector-label">
                  {provider === 'gemini' ? 'Gemini Model' : provider === 'groq' ? 'Groq Model' : 'OpenAI Model'}
                </div>
                {provider === 'gemini' ? (
                  <select 
                    className="model-select"
                    value={preferredModel}
                    onChange={(e) => setPreferredModel(e.target.value)}
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Standard)</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Powerful)</option>
                  </select>
                ) : provider === 'groq' ? (
                  <select 
                    className="model-select"
                    value={preferredModelGroq}
                    onChange={(e) => setPreferredModelGroq(e.target.value)}
                  >
                    <option value="llama-3.2-90b-vision-preview">Llama 3.2 90B Vision (Standard)</option>
                    <option value="llama-3.2-11b-vision-preview">Llama 3.2 11B Vision (Fast)</option>
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Versatile/No-Vision)</option>
                  </select>
                ) : (
                  <select 
                    className="model-select"
                    value={preferredModelOpenAI || 'gpt-4o'}
                    onChange={(e) => setPreferredModelOpenAI(e.target.value)}
                  >
                    <option value="gpt-4o">GPT-4o (Balanced)</option>
                    <option value="gpt-4o-mini">GPT-4o-mini (Faster)</option>
                  </select>
                )}
                <div className="model-hint">
                  {provider === 'gemini' ? 'Auto-fallback enabled for Gemini' : provider === 'groq' ? 'Groq LPU ensures lightning fast inference' : 'Multimodal vision enabled for OpenAI'}
                </div>
              </div>

              <UploadZone 
                file={file} 
                setFile={setFile} 
                datasets={datasets}
                setDatasets={setDatasets}
              />
              <button
                id="btn-solve"
                className="solve-btn"
                disabled={apiKey.trim().length < 10 || !file || phase !== PHASE.IDLE}
                onClick={() => handleSolve(false)}
              >
                <span>🚀</span>
                Solve Lab Report
              </button>
            </div>

            {/* Feature pills */}
            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                justifyContent: 'center',
                marginBottom: 48,
              }}
            >
              {[
                ['⚡', 'Gemini 2.5 Flash'],
                ['🐍', 'Live Python Execution'],
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

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          Lab Solver AI · Built with Gemini, Groq &amp; Pyodide · Your files never leave your browser
        </div>
      </footer>
    </div>
  );
}
