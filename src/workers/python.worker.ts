/// <reference lib="webworker" />

// Lazy-loaded Pyodide Web Worker for stateful Python execution.
// Maintains persistent `globals()` across code blocks in the active notebook.

const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';

interface PyodideInstance {
  loadPackage(packages: string | string[]): Promise<void>;
  loadPackagesFromImports(code: string): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
  globals: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  pyimport(name: string): { install(pkg: string | string[]): Promise<void> };
}

let pyodide: PyodideInstance | null = null;
let micropipLoaded = false;

const KNOWN_PYODIDE_WHEELS = new Set([
  'numpy', 'pandas', 'scipy', 'matplotlib', 'scikit-learn', 'sklearn',
  'xgboost', 'sympy', 'pillow', 'PIL', 'networkx', 'statsmodels',
  'micropip', 'pytz', 'dateutil', 'lxml', 'beautifulsoup4', 'bs4',
]);

const IMPORT_TO_PACKAGE: Record<string, string> = {
  sklearn: 'scikit-learn',
  PIL: 'pillow',
  bs4: 'beautifulsoup4',
  cv2: 'opencv-python',
  yaml: 'pyyaml',
};

const PURE_PYTHON_PYPI_ALLOWLIST = new Set([
  'mutagen', 'tabulate', 'faker', 'humanize', 'rich', 'tqdm', 'pydantic',
]);

function postStatus(requestId: string, message: string) {
  self.postMessage({ type: 'status', requestId, message });
}

async function ensurePyodide(requestId: string): Promise<PyodideInstance> {
  if (pyodide) return pyodide;

  postStatus(requestId, 'Loading Python WebAssembly runtime...');
  const mod = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
  )) as {
    loadPyodide: (config: { indexURL: string }) => Promise<PyodideInstance>;
  };

  pyodide = await mod.loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
  });

  // Bootstrap execution harness inside persistent Python namespace
  await pyodide.runPythonAsync(`
import sys, io, ast, base64, json, traceback

__canvas_globals__ = {"__name__": "__main__"}
__canvas_images__ = []
__canvas_tables__ = []

def __canvas_patch_matplotlib__():
    if "matplotlib" not in sys.modules:
        return
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        if getattr(plt, "__canvas_patched__", False):
            return
        def _canvas_show(*args, **kwargs):
            for fig_num in plt.get_fignums():
                fig = plt.figure(fig_num)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor="#1E1F20", edgecolor="none")
                buf.seek(0)
                b64 = base64.b64encode(buf.read()).decode("ascii")
                __canvas_images__.append("data:image/png;base64," + b64)
            plt.close("all")
        plt.show = _canvas_show
        plt.__canvas_patched__ = True
    except Exception:
        pass

def __canvas_format_result__(val):
    if val is None:
        return None
    # Detect pandas DataFrame for rich tabular output
    cls_mod = getattr(type(val), "__module__", "")
    cls_name = type(val).__name__
    if cls_mod.startswith("pandas") and cls_name == "DataFrame":
        max_rows = 200
        truncated = len(val) > max_rows
        preview = val.head(max_rows)
        cols = [str(c) for c in preview.columns.tolist()]
        rows = []
        for row in preview.itertuples(index=False, name=None):
            rows.append([None if (v != v) else (v if isinstance(v, (int, float, bool, str)) else str(v)) for v in row])
        __canvas_tables__.append({
            "columns": cols,
            "rows": rows,
            "rowCount": int(len(val)),
            "truncated": truncated
        })
        return None
    return repr(val)

async def __canvas_exec__(source_code):
    __canvas_images__.clear()
    __canvas_tables__.clear()
    __canvas_patch_matplotlib__()

    tree = ast.parse(source_code, mode="exec")
    last_expr_node = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr_node = ast.Expression(body=tree.body.pop().value)

    if tree.body:
        compiled_body = compile(tree, "<notebook>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        coro = eval(compiled_body, __canvas_globals__)
        if coro is not None and hasattr(coro, "__await__"):
            await coro

    __canvas_patch_matplotlib__()

    # Auto-flush open matplotlib figures even if user omitted plt.show()
    if "matplotlib.pyplot" in sys.modules:
        import matplotlib.pyplot as plt
        if plt.get_fignums():
            plt.show()

    expr_repr = None
    if last_expr_node is not None:
        compiled_expr = compile(last_expr_node, "<notebook>", "eval", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        val = eval(compiled_expr, __canvas_globals__)
        if val is not None and hasattr(val, "__await__"):
            val = await val
        expr_repr = __canvas_format_result__(val)

    return json.dumps({
        "expr": expr_repr,
        "images": list(__canvas_images__),
        "tables": list(__canvas_tables__),
    })
  `);

  return pyodide;
}

function detectTopLevelImports(code: string): string[] {
  const found = new Set<string>();
  const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

async function resolveImports(py: PyodideInstance, code: string, requestId: string) {
  const imports = detectTopLevelImports(code);
  if (imports.length === 0) return;

  const wheelsToLoad: string[] = [];
  const pypiToInstall: string[] = [];

  for (const modName of imports) {
    const mapped = IMPORT_TO_PACKAGE[modName] || modName;
    if (KNOWN_PYODIDE_WHEELS.has(modName) || KNOWN_PYODIDE_WHEELS.has(mapped)) {
      wheelsToLoad.push(mapped);
    } else if (PURE_PYTHON_PYPI_ALLOWLIST.has(modName)) {
      pypiToInstall.push(modName);
    }
  }

  if (wheelsToLoad.length > 0) {
    postStatus(requestId, `Loading Python packages (${wheelsToLoad.join(', ')})...`);
    try {
      await py.loadPackage(wheelsToLoad);
    } catch {
      // Fallback to Pyodide built-in import scanner
    }
  }

  try {
    await py.loadPackagesFromImports(code);
  } catch {
    // Non-Pyodide imports handled below or raised cleanly by Python
  }

  if (pypiToInstall.length > 0) {
    if (!micropipLoaded) {
      postStatus(requestId, 'Loading micropip installer...');
      await py.loadPackage('micropip');
      micropipLoaded = true;
    }
    postStatus(requestId, `Installing ${pypiToInstall.join(', ')} via micropip...`);
    const micropip = py.pyimport('micropip');
    await micropip.install(pypiToInstall);
  }
}

self.onmessage = async (event: MessageEvent<{ type: string; requestId: string; code?: string }>) => {
  const { type, requestId, code = '' } = event.data;

  if (type !== 'run') return;

  const startedAt = performance.now();
  let stdoutBuf = '';
  let stderrBuf = '';

  try {
    const py = await ensurePyodide(requestId);

    py.setStdout({
      batched: (text: string) => {
        stdoutBuf += text + '\n';
        self.postMessage({ type: 'stream', requestId, stream: 'stdout', chunk: text + '\n' });
      },
    });

    py.setStderr({
      batched: (text: string) => {
        stderrBuf += text + '\n';
        self.postMessage({ type: 'stream', requestId, stream: 'stderr', chunk: text + '\n' });
      },
    });

    await resolveImports(py, code, requestId);

    postStatus(requestId, 'Running Python...');
    py.globals.set('__canvas_src__', code);
    const rawJson = (await py.runPythonAsync('await __canvas_exec__(__canvas_src__)')) as string;
    const parsed = JSON.parse(rawJson || '{}') as {
      expr?: string | null;
      images?: string[];
      tables?: Array<{
        columns: string[];
        rows: Array<Array<string | number | boolean | null>>;
        rowCount: number;
        truncated?: boolean;
      }>;
    };

    if (parsed.expr !== null && parsed.expr !== undefined) {
      stdoutBuf += (stdoutBuf && !stdoutBuf.endsWith('\n') ? '\n' : '') + parsed.expr + '\n';
    }

    self.postMessage({
      type: 'result',
      requestId,
      stdout: stdoutBuf.replace(/\n$/, ''),
      stderr: stderrBuf.replace(/\n$/, ''),
      images: parsed.images || [],
      tables: parsed.tables || [],
      durationMs: Math.round(performance.now() - startedAt),
      provider: 'Pyodide Wasm',
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const combinedErr = [stderrBuf.trim(), errMessage].filter(Boolean).join('\n');
    self.postMessage({
      type: 'error',
      requestId,
      stdout: stdoutBuf.replace(/\n$/, ''),
      stderr: combinedErr,
      durationMs: Math.round(performance.now() - startedAt),
      provider: 'Pyodide Wasm',
    });
  }
};
