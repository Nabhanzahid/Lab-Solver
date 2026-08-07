/**
 * Pyodide service — runs Python code inside the browser
 * Uses Pyodide loaded via CDN script tag
 */

let pyodideInstance = null;
let pyodideLoading = false;
let pyodideReady = false;

/**
 * Load Pyodide (only needs to happen once)
 */
export async function loadPyodideRuntime(onStatus) {
  if (pyodideReady) return pyodideInstance;
  if (pyodideLoading) {
    // Wait for existing load
    while (pyodideLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return pyodideInstance;
  }

  pyodideLoading = true;
  onStatus?.('Loading Python runtime (Pyodide)...');

  // Dynamically load Pyodide script
  await new Promise((resolve, reject) => {
    if (window.loadPyodide) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  onStatus?.('Initializing Python environment...');
  pyodideInstance = await window.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  pyodideReady = true;
  pyodideLoading = false;
  onStatus?.('Python runtime ready!');
  return pyodideInstance;
}

/**
 * Execute Python code using a robust Python-side wrapper for error capturing
 * @param {string} code - Python code to run
 * @returns {{ output: string, error: string | null }}
 */
export async function runPythonCode(code) {
  if (!pyodideReady || !pyodideInstance) {
    throw new Error('Pyodide not loaded yet');
  }

  try {
    // 1. Pre-load packages from imports (must happen before wrapper)
    await pyodideInstance.loadPackagesFromImports(code);

    // 2. Wrap user code in Python-side error capturing
    // We use a JSON-based bridge to ensure precise traceback transfer
    const wrapper = `
import sys
import io
import traceback
import json

# Capture stdout/stderr
_stdout = io.StringIO()
_stderr = io.StringIO()
sys.stdout = _stdout
sys.stderr = _stderr

_error_msg = None

try:
    # We use globals() to preserve state between cells (notebook behavior)
    exec(${JSON.stringify(code)}, globals())
except Exception:
    _error_msg = traceback.format_exc()

# Restore streams
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__

# Return detailed results
json.dumps({
    "output": _stdout.getvalue(),
    "error": _error_msg or (_stderr.getvalue() if _stderr.getvalue() else None)
})
    `;
    
    const resultJson = await pyodideInstance.runPythonAsync(wrapper);
    const result = JSON.parse(resultJson);

    // Cleanup: specifically remove the "PythonError: " prefix that Pyodide adds (if any leaked)
    if (result.error && result.error.startsWith('PythonError: ')) {
      result.error = result.error.replace('PythonError: ', '');
    }

    return result;
  } catch (err) {
    // This catches critical JS/Pyodide errors (e.g. interpreter crash)
    return {
      output: '',
      error: err.message || String(err)
    };
  }
}

/**
 * Write files to Pyodide virtual file system
 * @param {Array<File>} files 
 */
export async function mountFiles(files) {
  if (!pyodideReady || !pyodideInstance) {
    throw new Error('Pyodide not loaded yet');
  }
  
  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    pyodideInstance.FS.writeFile(file.name, data);
    console.log(`[Pyodide] Registered local file: ${file.name}`);
  }
}

export function isPyodideReady() {
  return pyodideReady;
}
