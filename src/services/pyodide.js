// ─────────────────────────────────────────────────────────────
// pyodide.js  –  Browser Python execution engine
//
// KEY FIX: Uses a PERSISTENT globals dict shared across all
// runCell() calls, exactly like a real Jupyter kernel. This
// means Cell 0 variables are visible in Cell 3, etc.
// ─────────────────────────────────────────────────────────────

let _pyodide = null;
let _loading  = null;
let _ready    = false;

export async function loadPyodideRuntime(onStatus = () => {}) {
  if (_ready) return _pyodide;
  if (_loading) return _loading;

  _loading = (async () => {
    onStatus('Loading Python runtime…');
    if (!window.loadPyodide) {
      await new Promise((resolve, reject) => {
        const s  = document.createElement('script');
        s.src    = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js';
        s.onload  = resolve;
        s.onerror = () => reject(new Error('Failed to load Pyodide'));
        document.head.appendChild(s);
      });
    }

    onStatus('Initializing Python environment…');
    _pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/' });

    // Install common packages silently
    onStatus('Installing numpy, pandas, matplotlib, seaborn, scikit-learn…');
    try {
      await _pyodide.loadPackage(['numpy', 'pandas', 'matplotlib', 'seaborn', 'scikit-learn', 'scipy']);
    } catch { /* non-fatal */ }

    // Create a PERSISTENT globals namespace that all cells will share
    // This is the crucial difference from running each cell in isolation
    await _pyodide.runPythonAsync(`
import sys, io, traceback, json, warnings
warnings.filterwarnings('ignore')

# Shared execution namespace — persists across all runCell() calls
_NB_GLOBALS = {
    '__name__': '__main__',
    '__builtins__': __builtins__,
}
print("Python kernel ready ✓")
`);

    _ready = true;
    onStatus('Python runtime ready ✓');
    return _pyodide;
  })();

  return _loading;
}

export function isPyodideReady() {
  return _ready;
}

/**
 * Run a single notebook cell in the shared globals namespace.
 * Returns { output: string, error: string|null }
 */
export async function runCell(code) {
  if (!_ready || !_pyodide) throw new Error('Pyodide not loaded');

  // Install any packages the cell imports that aren't yet available
  try {
    await _pyodide.loadPackagesFromImports(code);
  } catch { /* best-effort */ }

  const wrappedCode = `
import sys, io, traceback, json

_out = io.StringIO()
_err = io.StringIO()
_old_stdout = sys.stdout
_old_stderr = sys.stderr
sys.stdout  = _out
sys.stderr  = _err
_exec_error = None

try:
    exec(${JSON.stringify(code)}, _NB_GLOBALS)
except Exception:
    _exec_error = traceback.format_exc()
finally:
    sys.stdout = _old_stdout
    sys.stderr = _old_stderr

json.dumps({
    "output": _out.getvalue(),
    "stderr": _err.getvalue(),
    "error":  _exec_error,
})
`;

  const raw = await Promise.race([
    _pyodide.runPythonAsync(wrappedCode),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Cell timed out after 120s')), 120000)),
  ]);

  const result = JSON.parse(raw);
  return {
    output: result.output || '',
    error:  result.error  || (result.stderr?.trim() ? result.stderr : null),
  };
}

/**
 * Reset the shared globals — call before a fresh solve run
 */
export async function resetKernel() {
  if (!_ready || !_pyodide) return;
  await _pyodide.runPythonAsync(`
_NB_GLOBALS = {
    '__name__': '__main__',
    '__builtins__': __builtins__,
}
`);
}

/**
 * Write files into the Pyodide virtual filesystem so Python code can
 * read them with pd.read_csv('filename.csv') or plt.imread('img.jpg').
 * @param {Array<{name: string, buffer: ArrayBuffer}>} files
 */
export async function writeFilesToKernel(files) {
  if (!_ready || !_pyodide || !files?.length) return;
  for (const item of files) {
    try {
      // Handle both {name, buffer} and {file: File, filename: string} structures
      let name, buffer;
      if (item.file && item.filename) {
        name = item.filename;
        buffer = await item.file.arrayBuffer();
      } else {
        name = item.name;
        buffer = item.buffer;
      }

      if (name && buffer) {
        console.log(`[Pyodide] Writing file: ${name} (${buffer.byteLength || buffer.size} bytes)`);
        _pyodide.FS.writeFile(name, new Uint8Array(buffer));
      }
    } catch (err) {
      console.error(`[Pyodide] Critical error writing file:`, err);
    }
  }
}

