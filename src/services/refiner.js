// ─────────────────────────────────────────────────────────────
// refiner.js  –  Manual task refinement
//
// Called when the user types a refinement instruction into a
// task cell's input box. Has full context of:
//   - The task being refined
//   - All prior verified task codes (notebook context)
//   - Shared variables registry
// ─────────────────────────────────────────────────────────────

import { runCell, resetKernel, loadPyodideRuntime, writeFilesToKernel } from './pyodide.js';

async function callRefineAPI({ prompt, provider, apiKey, model }) {
  const fetchJSON = async (url, body, headers = {}) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(`API error: ${e?.error?.message || r.status}`);
    }
    return r.json();
  };

  let raw;
  if (provider === 'gemini') {
    const v    = model.includes('1.5') ? 'v1' : 'v1beta';
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        ...(v === 'v1beta' ? { response_mime_type: 'application/json' } : {}),
      },
    };
    const json = await fetchJSON(
      `https://generativelanguage.googleapis.com/${v}/models/${model}:generateContent?key=${apiKey}`,
      body,
    );
    raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    const body = {
      model,
      messages:        [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature:     0.15,
    };
    const json = await fetchJSON(
      'https://api.openai.com/v1/chat/completions',
      body,
      { Authorization: `Bearer ${apiKey}` },
    );
    raw = json?.choices?.[0]?.message?.content;
  }

  if (!raw) throw new Error('Refiner returned an empty response');
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

/**
 * Refines a single task based on user instruction.
 * After getting the new code from AI, immediately verifies it
 * with Pyodide (if loaded) and retries once if it fails.
 *
 * @param {object} task            - the task to refine
 * @param {string} instruction     - user's instruction
 * @param {Array}  allTasks        - full tasks array for context
 * @param {object} labData         - full labData for sharedVariables
 * @param {string} provider
 * @param {string} apiKey
 * @param {string} model
 * @returns {object} updatedTask with verifiedCode + verifiedOutput
 */
export async function refineLabTask(taskIndex, task, instruction, allTasks, labData, provider, apiKey, model, providedFiles = []) {
  const sharedVars = labData.sharedVariables || [];

  // Build prior cells context
  const priorContext = allTasks
    .filter(t => t.taskNumber < task.taskNumber && t.hasCode && (t.verifiedCode || t.code))
    .map(t => `# Task ${t.taskNumber}: ${t.title}\n${t.verifiedCode || t.code}`)
    .join('\n\n---\n\n');

  const varList = sharedVars
    .map(v => `  ${v.name}: ${v.type} — ${v.description || ''}`)
    .join('\n');

  const availableFiles = providedFiles.length > 0
    ? `AVAILABLE FILES in current directory: ${providedFiles.map(f => f.filename).join(', ')}`
    : '# (No external files provided)';

  const prompt = `You are an expert Python/Data Science assistant refining a Jupyter notebook cell.

NOTEBOOK CONTEXT — Prior cells already executed successfully:
\`\`\`python
${priorContext || '# (No prior cells)'}
\`\`\`

SHARED VARIABLES in globals():
${varList || '  (none declared)'}

${availableFiles}

CURRENT TASK — Task ${task.taskNumber}: ${task.title}
Description: ${task.description}
Current code:
\`\`\`python
${task.verifiedCode || task.code || '# No code yet'}
\`\`\`
Current output: ${task.verifiedOutput || '(none)'}

USER INSTRUCTION: "${instruction}"

RULES:
1. This cell runs in a shared globals() namespace — do NOT redefine variables from prior cells.
2. Apply the user's instruction precisely.
3. Keep all matplotlib calls with plt.tight_layout() and plt.show().
4. Return ONLY a JSON object with these exact keys:
   - "title": updated task title (string)
   - "description": updated description (string)
   - "solution": explanation of what was done and why, in past/general tense (string)
   - "code": the complete updated Python code (string)
   - "hasCode": true or false (boolean)
   - "outputAnalysis": description of what the code achieved and produced, in past/general tense (string)
   - "producesVars": list of variable names this cell defines for later tasks (array of strings)
No markdown fences, no extra text.`;

  const updated = await callRefineAPI({ prompt, provider, apiKey, model });

  // ── Replay the full notebook context before verifying ──────────
  // We reset the kernel and replay Cell 0 + global imports + all prior
  // verified tasks so the refined cell runs in the correct namespace.
  let verifiedCode    = updated.code;
  let verifiedOutput  = null;
  let executionStatus = 'refined_unverified';

  if (updated.hasCode && updated.code?.trim()) {
    try {
      await loadPyodideRuntime();
      await resetKernel();

      // Replay provided files
      if (providedFiles.length > 0) {
        await writeFilesToKernel(providedFiles);
      }

      // Replay mock data (Cell 0)
      if (labData.mockDataCode?.trim()) {
        await runCell(labData.mockDataCode);
      }

      // Replay global imports
      const globalSetup = `
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
warnings.filterwarnings('ignore')
plt.style.use('seaborn-v0_8-muted')
try:
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, mean_squared_error, r2_score, classification_report
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
except ImportError:
    pass
try:
    from scipy import stats
except ImportError:
    pass
`.trim();
      await runCell(globalSetup);

      // Replay all prior tasks based on index
      for (let i = 0; i < taskIndex; i++) {
        const t = allTasks[i];
        if (t.hasCode && (t.verifiedCode || t.code)?.trim()) {
          await runCell(t.verifiedCode || t.code);
        }
      }

      // Now run the refined cell
      const result = await runCell(updated.code);

      if (!result.error) {
        verifiedOutput  = result.output || '[Cell executed successfully]';
        executionStatus = 'refined_verified';
      } else {
        // One auto-fix attempt
        const fixPrompt = `${prompt}

ADDITIONAL: Your refined code produced this error when executed:
${result.error}

Fix it. Same JSON format.`;
        try {
          const fixed = await callRefineAPI({ prompt: fixPrompt, provider, apiKey, model });
          const r2    = await runCell(fixed.code);
          if (!r2.error) {
            verifiedCode    = fixed.code;
            verifiedOutput  = r2.output || '[Cell executed successfully after fix]';
            executionStatus = 'refined_fixed';
          } else {
            verifiedOutput  = `[Execution Warning]\n${r2.error}`;
            executionStatus = 'refined_failed';
          }
        } catch {
          verifiedOutput  = `[Execution Warning]\n${result.error}`;
          executionStatus = 'refined_failed';
        }
      }
    } catch {
      // Pyodide not available — that's OK, skip verification
      executionStatus = 'refined_unverified';
    }
  }

  return {
    ...task,
    ...updated,
    verifiedCode,
    verifiedOutput,
    executionStatus,
    taskNumber: task.taskNumber, // always preserve
  };
}

// ─────────────────────────────────────────────────────────────
// Re-verify all tasks AFTER the refined task index.
// Called from App.jsx when a refinement may have changed variables
// that downstream tasks depend on.
// ─────────────────────────────────────────────────────────────
export async function reVerifyDownstreamTasks(
  tasks,
  labData,
  fromIndex,
  provider,
  apiKey,
  model,
  onTaskDone,
  providedFiles = [],
) {
  const HEAVY_LIB_PATTERN = /\b(tensorflow|keras|torch|torchvision|cv2|PIL|pygame|theano)\b/i;
  const updatedTasks = [...tasks];

  try {
    await loadPyodideRuntime();
    await resetKernel();

    // Replay provided files
    if (providedFiles.length > 0) {
      await writeFilesToKernel(providedFiles);
    }

    // Replay Cell 0
    if (labData.mockDataCode?.trim()) {
      await runCell(labData.mockDataCode);
    }

    // Replay global imports
    const globalSetup = `
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
warnings.filterwarnings('ignore')
plt.style.use('seaborn-v0_8-muted')
try:
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, mean_squared_error, r2_score, classification_report
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
except ImportError:
    pass
try:
    from scipy import stats
except ImportError:
    pass
`.trim();
    await runCell(globalSetup);

    // Replay all tasks up to (and including) the refined task
    for (let i = 0; i <= fromIndex; i++) {
      const t = updatedTasks[i];
      if (t.hasCode && (t.verifiedCode || t.code)?.trim()) {
        await runCell(t.verifiedCode || t.code);
      }
    }

    // Now re-verify each downstream task
    for (let i = fromIndex + 1; i < updatedTasks.length; i++) {
      const t = { ...updatedTasks[i] };
      if (!t.hasCode || !t.code?.trim()) {
        updatedTasks[i] = t;
        onTaskDone?.(i, t);
        continue;
      }

      if (HEAVY_LIB_PATTERN.test(t.verifiedCode || t.code)) {
        // Skip heavy lib tasks but still replay their stubs
        updatedTasks[i] = t;
        onTaskDone?.(i, t);
        continue;
      }

      const result = await runCell(t.verifiedCode || t.code);
      if (!result.error) {
        t.verifiedOutput  = result.output || '[Cell executed successfully]';
        t.executionStatus = 'refined_verified';
      } else {
        // Mark as needing review — don't wipe code
        t.verifiedOutput  = `[Execution Warning]\n${result.error}`;
        t.executionStatus = 'refined_failed';
      }
      updatedTasks[i] = t;
      onTaskDone?.(i, t);
    }
  } catch {
    // Pyodide not available — skip cascade verification silently
  }

  return updatedTasks;
}
