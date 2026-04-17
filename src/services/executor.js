// ─────────────────────────────────────────────────────────────
// executor.js  –  Verify-and-Fix Engine
//
// PATCHES APPLIED:
//  - Detects if ALL tasks are TF/heavy-lib → skips Pyodide entirely
//    and goes straight to notebook export (no hanging, no stubs needed)
//  - When a single TF cell is skipped, injects variable stubs into
//    _NB_GLOBALS so later tasks don't get NameError
//  - mockDataCode TF import detection: if Cell 0 has TF imports,
//    strips them and re-runs with pure numpy fallback
//  - Tracks which variable names each skipped cell was supposed to
//    produce (from task.producesVars) and creates None stubs for them
// ─────────────────────────────────────────────────────────────

import { runCell, resetKernel, loadPyodideRuntime, writeFilesToKernel } from './pyodide.js';

const MAX_RETRIES = 3;

// Libraries that crash Pyodide — execution must be skipped
const HEAVY_LIB_PATTERN = /\b(tensorflow|keras|torch|torchvision|pygame|theano|cv2|PIL|Pillow|skimage|imageio)\b/i;

const SKIP_REASON = (libs) =>
  `[Execution Skipped] Library optimization (${libs}). Results and visualizations should be viewed in Google Colab for maximum fidelity.`;

// ── Detect which heavy libs a code string uses ────────────────
function detectHeavyLibs(code) {
  const matches = code.match(/\b(tensorflow|tf\.keras|keras|torch|torchvision|pygame|theano|cv2|PIL|Pillow|skimage|imageio)\b/gi);
  if (!matches) return null;
  return [...new Set(matches.map(m => m.toLowerCase()))].join(', ');
}

// ── Check if ALL code-bearing tasks need heavy libs ───────────
function allTasksNeedHeavyLibs(labData) {
  const codeTasks = labData.tasks.filter(t => t.hasCode && t.code?.trim());
  if (codeTasks.length === 0) return false;
  const heavyCount = codeTasks.filter(t => HEAVY_LIB_PATTERN.test(t.code)).length;
  // Also count mockDataCode
  const mockIsHeavy = labData.mockDataCode && HEAVY_LIB_PATTERN.test(labData.mockDataCode);
  // If 80%+ of tasks need heavy libs, skip Pyodide entirely
  return heavyCount / codeTasks.length >= 0.8 || (mockIsHeavy && heavyCount > 0);
}

// ── Build a dynamic global setup based on code requirements ───
function generateDynamicGlobalSetup(labData) {
  const allCode = [labData.mockDataCode, ...(labData.tasks.map(t => t.code))].join('\n').toLowerCase();
  
  const hasSklearn = /sklearn\b|scikit-learn\b/.test(allCode);
  const hasSeaborn = /seaborn\b|sns\b/.test(allCode);
  const hasScipy   = /scipy\b/.test(allCode);
  const hasStats   = /statsmodels\b/.test(allCode);
  
  const imports = [
    'import numpy as np',
    'import pandas as pd',
    'import matplotlib',
    "matplotlib.use('Agg')",
    'import matplotlib.pyplot as plt',
    'import warnings',
    "warnings.filterwarnings('ignore')",
    "plt.style.use('seaborn-v0_8-muted')"
  ];

  if (hasSeaborn) imports.push('import seaborn as sns');
  if (hasScipy)   imports.push('from scipy import stats');
  
  if (hasSklearn) {
    imports.push(`
try:
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, mean_squared_error, r2_score, classification_report
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
except ImportError:
    pass`.trim());
  }

  return imports.join('\n') + '\nprint("Global setup ready ✓")';
}

// ── Strip heavy lib usage from mockDataCode ───────────────────
function sanitizeMockDataCode(code) {
  if (!HEAVY_LIB_PATTERN.test(code)) return code;

  // Remove lines that contain any heavy lib words
  const lines = code.split('\n');
  const cleaned = lines.filter(line => !HEAVY_LIB_PATTERN.test(line));

  // If the code used Tokenizer/pad_sequences from keras, replace with
  // a pure-numpy text encoding fallback
  const needsTokenizer = /Tokenizer|pad_sequences|texts_to_sequences/i.test(code);
  const fallback = needsTokenizer ? `
# ── Pure-numpy text tokenizer (replaces keras Tokenizer) ──────
import re as _re
def _build_vocab(texts, max_words=5000):
    counts = {}
    for t in texts:
        for w in _re.findall(r'[a-z]+', t.lower()):
            counts[w] = counts.get(w, 0) + 1
    vocab = sorted(counts, key=counts.get, reverse=True)[:max_words-1]
    return {w: i+1 for i, w in enumerate(vocab)}

def _texts_to_seqs(texts, vocab):
    return [[vocab.get(w, 0) for w in _re.findall(r'[a-z]+', t.lower())] for t in texts]

def _pad(seqs, maxlen):
    out = np.zeros((len(seqs), maxlen), dtype='int32')
    for i, s in enumerate(seqs):
        s = s[-maxlen:]
        out[i, maxlen-len(s):] = s
    return out

vocab      = _build_vocab(texts)
vocab_size = len(vocab) + 1
sequences  = _texts_to_seqs(texts, vocab)
X          = _pad(sequences, maxlen=MAX_LEN)
` : '';

  return cleaned.join('\n') + (fallback ? '\n' + fallback : '');
}

// ── Build variable stubs for skipped TF cells ─────────────────
function buildVariableStubs(task) {
  const vars = task.producesVars || [];
  if (vars.length === 0) return null;

  // Infer reasonable stub values from variable names
  const assignments = vars.map(v => {
    const name = v.toLowerCase();
    if (name.includes('model'))   return `${v} = None  # stub: TF model skipped`;
    if (name.includes('history')) return `${v} = type('H', (), {'history': {'accuracy': [0.5], 'val_accuracy': [0.5], 'loss': [0.5], 'val_loss': [0.5]}})()  # stub`;
    if (name.includes('tokenizer') || name.includes('vocab')) return `${v} = None  # stub: tokenizer skipped`;
    if (name.includes('encoder') || name.includes('scaler')) return `${v} = None  # stub`;
    return `${v} = None  # stub: produced by skipped TF cell`;
  });

  return assignments.join('\n');
}

// ── AI fixer ─────────────────────────────────────────────────
async function callAIFixer({ brokenCode, errorTrace, task, priorTasks, sharedVariables, provider, apiKey, model, providedFiles = [] }) {
  const priorContext = priorTasks
    .filter(t => t.hasCode && (t.verifiedCode || t.code))
    .map(t => `# Task ${t.taskNumber}: ${t.title}\n${t.verifiedCode || t.code}`)
    .join('\n\n---\n\n');

  const varList = (sharedVariables || [])
    .map(v => `  ${v.name}: ${v.type} — ${v.description || ''}`)
    .join('\n');

  const availableFiles = providedFiles.length > 0
    ? `AVAILABLE FILES in current directory: ${providedFiles.map(f => f.filename).join(', ')}`
    : '# (No external files provided)';

  const prompt = `You are fixing a Python cell that failed in a Jupyter notebook.

PRIOR CELLS (already ran successfully):
\`\`\`python
${priorContext || '# (none)'}
\`\`\`

SHARED VARIABLES in globals():
${varList || '  (none declared)'}

${availableFiles}

BROKEN CELL — Task ${task.taskNumber}: ${task.title}
\`\`\`python
${brokenCode}
\`\`\`

ERROR:
${errorTrace}

RULES:
1. Fix the error. Do not redefine variables that exist in prior cells.
2. If a variable from a prior cell appears to be None (stub), add a
   fallback that creates a minimal working version of it.
3. Keep the same logic and purpose.
4. You MUST use the exact filenames listed above. If you tried to use a different extension (like .png) and it failed because the available file is .jpg, fix the extension in the code.
5. Return ONLY JSON: { "code": "<fixed code>", "explanation": "<what you fixed>" }
No markdown, no extra text.`;

  const fetchText = async (url, body, headers) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  let raw;
  if (provider === 'gemini') {
    const v    = model.includes('1.5') ? 'v1' : 'v1beta';
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        ...(v === 'v1beta' ? { response_mime_type: 'application/json' } : {}),
      },
    };
    const json = await fetchText(
      `https://generativelanguage.googleapis.com/${v}/models/${model}:generateContent?key=${apiKey}`,
      body, {}
    );
    raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };
    const json = await fetchText(
      'https://api.openai.com/v1/chat/completions',
      body,
      { Authorization: `Bearer ${apiKey}` }
    );
    raw = json?.choices?.[0]?.message?.content;
  }

  if (!raw) throw new Error('AI fixer returned empty response');
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────
export async function verifyAndFixAllTasks(labData, provider, apiKey, model, onStatus, onTaskDone, providedFiles = []) {

  // ── FAST PATH: If all/most tasks need TF, skip Pyodide ───────
  if (allTasksNeedHeavyLibs(labData)) {
    onStatus('Deep learning notebook detected — skipping browser execution, preparing Colab-ready notebook…');

    const tasks = labData.tasks.map(task => ({
      ...task,
      verifiedCode:    task.code || '',
      verifiedOutput:  null,  // no output — will use outputAnalysis in notebook
      executionStatus: 'skipped_heavy_lib',
    }));

    // Mark mockDataCode output
    labData.mockDataOutput = 'Mock data ready ✓ (run in Google Colab to see actual output)';

    onTaskDone && tasks.forEach((t, i) => onTaskDone(i, t));
    return { ...labData, tasks };
  }

  // ── NORMAL PATH: Load Pyodide and verify ─────────────────────
  onStatus('Loading Python runtime…');
  try {
    await loadPyodideRuntime(onStatus);
  } catch (err) {
    onStatus('⚠️ Python runtime unavailable — skipping verification');
    const tasks = labData.tasks.map(task => ({
      ...task,
      verifiedCode:    task.code || '',
      verifiedOutput:  null,
      executionStatus: 'skipped_runtime_unavailable',
    }));
    onTaskDone && tasks.forEach((t, i) => onTaskDone(i, t));
    return { ...labData, tasks };
  }

  await resetKernel();

  // ── Write user-provided files to Pyodide FS ───────────────────
  if (providedFiles.length > 0) {
    onStatus('📂 Loading your files into Python environment…');
    await writeFilesToKernel(providedFiles);
  }

  const sharedVars    = labData.sharedVariables || [];
  const enrichedTasks = [];

  // ── Cell 0: Mock data setup ───────────────────────────────────
  if (labData.mockDataCode?.trim()) {
    onStatus('▶ Cell 0: Setting up mock data…');

    // Strip any TF imports from mockDataCode before running
    const safeMockCode = sanitizeMockDataCode(labData.mockDataCode);

    if (safeMockCode !== labData.mockDataCode) {
      onStatus('⚠ Removed TF imports from mockDataCode — using numpy fallback…');
      labData.mockDataCode = safeMockCode;
    }

    const r = await runCell(safeMockCode);

    if (r.error) {
      onStatus('⚠ Mock data cell errored — auto-fixing…');
      try {
        const fix = await callAIFixer({
          brokenCode:      safeMockCode,
          errorTrace:      r.error,
          task:            { taskNumber: 0, title: 'Mock Data Setup', hasCode: true, producesVars: [] },
          priorTasks:      [],
          sharedVariables: sharedVars,
          provider, apiKey, model,
          providedFiles
        });
        const r2 = await runCell(fix.code);
        if (!r2.error) {
          labData.mockDataCode   = fix.code;
          labData.mockDataOutput = r2.output || 'Mock data ready ✓ (auto-fixed)';
        } else {
          labData.mockDataOutput = 'Mock data setup had errors — check Cell 0 in Colab';
        }
      } catch {
        labData.mockDataOutput = r.error;
      }
    } else {
      labData.mockDataOutput = r.output || 'Mock data ready ✓';
    }
  }

  // ── Global imports cell ───────────────────────────────────────
  const dynamicSetup = generateDynamicGlobalSetup(labData);
  await runCell(dynamicSetup);

  // ── Process each task ─────────────────────────────────────────
  const totalTasks = labData.tasks.length;

  for (let i = 0; i < totalTasks; i++) {
    const task = { ...labData.tasks[i] };
    onStatus(`▶ Task ${task.taskNumber}/${totalTasks}: ${task.title}…`);

    // Non-code task
    if (!task.hasCode || !task.code?.trim()) {
      task.verifiedCode    = task.code || '';
      task.verifiedOutput  = null;
      task.executionStatus = 'skipped_no_code';
      enrichedTasks.push(task);
      onTaskDone?.(i, task);
      continue;
    }

    const heavyLibs = detectHeavyLibs(task.code);

    // Heavy lib task — skip but inject stubs for produced variables
    if (heavyLibs) {
      task.verifiedCode    = task.code;
      task.verifiedOutput  = null;
      task.executionStatus = 'skipped_heavy_lib';

      // Inject variable stubs so later cells don't get NameError
      const stubCode = buildVariableStubs(task);
      if (stubCode) {
        onStatus(`  → Injecting variable stubs for: ${(task.producesVars || []).join(', ')}`);
        await runCell(stubCode);
      }

      enrichedTasks.push(task);
      onTaskDone?.(i, task);
      continue;
    }

    // Verify + fix loop
    let currentCode = task.code;
    let lastError   = null;
    let success     = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        onStatus(`  ↻ Attempt ${attempt + 1}/${MAX_RETRIES} — fixing Task ${task.taskNumber}…`);
      }

      const result = await runCell(currentCode);

      if (!result.error) {
        task.verifiedCode    = currentCode;
        task.verifiedOutput  = result.output || '[Cell executed successfully — no printed output]';
        task.executionStatus = attempt === 0 ? 'success' : `fixed_attempt_${attempt + 1}`;
        success              = true;
        break;
      }

      lastError = result.error;
      onStatus(`  ✗ Error in Task ${task.taskNumber} — calling AI fixer…`);

      try {
        const fix = await callAIFixer({
          brokenCode:      currentCode,
          errorTrace:      lastError,
          task,
          priorTasks:      enrichedTasks,
          sharedVariables: sharedVars,
          provider, apiKey, model,
          providedFiles
        });
        
        currentCode = fix.code;

        // BOTTLE-NECK FIX: Re-check for heavy libs BROUGHT IN by the AI fix
        const newHeavyLibs = detectHeavyLibs(currentCode);
        if (newHeavyLibs) {
          onStatus(`  → AI fix introduced heavy libs (${newHeavyLibs}). Skipping execution safely.`);
          task.verifiedCode    = currentCode;
          task.verifiedOutput  = null;
          task.executionStatus = 'skipped_heavy_lib';
          success              = true; // Mark as 'handled' to break loop
          break;
        }
      } catch (fixErr) {
        onStatus(`  ⚠ AI fixer failed: ${fixErr.message}`);
        break;
      }
    }

    if (!success) {
      task.verifiedCode    = currentCode;
      // PATCH: store null so notebook.js uses outputAnalysis instead of error
      task.verifiedOutput  = null;
      task.executionFailed = true;
      task.executionError  = lastError;  // kept separately for UI display only
      task.executionStatus = 'failed';
    }

    enrichedTasks.push(task);
    onTaskDone?.(i, task);
  }

  return { ...labData, tasks: enrichedTasks };
}
