import katex from 'katex';
import type { BlockExecutionOutput, CppEngine, NotebookBlock, TableOutput } from '../types';
import { createId } from './crypto';

type WorkerCallback = {
  resolve: (result: Partial<BlockExecutionOutput>) => void;
  onStatus?: (msg: string) => void;
  onStream?: (stream: 'stdout' | 'stderr', chunk: string) => void;
};

class RuntimeManager {
  private pythonWorker: Worker | null = null;
  private pythonNotebookId: string | null = null;
  private pythonPending = new Map<string, WorkerCallback>();

  private sqlWorker: Worker | null = null;
  private sqlNotebookId: string | null = null;
  private sqlPending = new Map<string, WorkerCallback>();

  private activeAbortController: AbortController | null = null;

  /**
   * Enforce 1-active-Pyodide-worker limit across notebooks:
   * auto-terminate inactive notebook workers when switching notebooks.
   */
  public syncActiveNotebook(notebookId: string): void {
    if (this.pythonWorker && this.pythonNotebookId !== notebookId) {
      this.terminatePythonKernel();
    }
    if (this.sqlWorker && this.sqlNotebookId !== notebookId) {
      this.terminateSqlKernel();
    }
  }

  public isPythonActive(): boolean {
    return this.pythonWorker !== null;
  }

  public isSqlActive(): boolean {
    return this.sqlWorker !== null;
  }

  public terminatePythonKernel(reason = 'Kernel interrupted and restarted.'): void {
    if (this.pythonWorker) {
      this.pythonWorker.terminate();
      this.pythonWorker = null;
      this.pythonNotebookId = null;
    }
    for (const [, cb] of this.pythonPending) {
      cb.resolve({
        status: 'error',
        stderr: reason,
        durationMs: 0,
      });
    }
    this.pythonPending.clear();
  }

  public terminateSqlKernel(reason = 'SQL kernel restarted.'): void {
    if (this.sqlWorker) {
      this.sqlWorker.terminate();
      this.sqlWorker = null;
      this.sqlNotebookId = null;
    }
    for (const [, cb] of this.sqlPending) {
      cb.resolve({
        status: 'error',
        stderr: reason,
        durationMs: 0,
      });
    }
    this.sqlPending.clear();
  }

  public abortAll(reason = 'Execution stopped by user.'): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.terminatePythonKernel(reason);
    this.terminateSqlKernel(reason);
  }

  private getOrSpawnPythonWorker(notebookId: string): Worker {
    if (this.pythonWorker && this.pythonNotebookId === notebookId) {
      return this.pythonWorker;
    }
    this.terminatePythonKernel();

    const worker = new Worker(new URL('../workers/python.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (
      event: MessageEvent<{
        type: 'status' | 'stream' | 'result' | 'error';
        requestId: string;
        message?: string;
        stream?: 'stdout' | 'stderr';
        chunk?: string;
        stdout?: string;
        stderr?: string;
        images?: string[];
        tables?: TableOutput[];
        durationMs?: number;
        provider?: string;
      }>
    ) => {
      const data = event.data;
      const cb = this.pythonPending.get(data.requestId);
      if (!cb) return;

      if (data.type === 'status' && data.message) {
        cb.onStatus?.(data.message);
        return;
      }
      if (data.type === 'stream' && data.stream && data.chunk) {
        cb.onStream?.(data.stream, data.chunk);
        return;
      }

      this.pythonPending.delete(data.requestId);
      cb.resolve({
        status: data.type === 'error' ? 'error' : 'success',
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        images: data.images || [],
        tables: data.tables || [],
        durationMs: data.durationMs ?? 0,
        provider: data.provider || 'Pyodide Wasm',
        runtimeMessage: undefined,
      });
    };

    worker.onerror = (err) => {
      this.terminatePythonKernel(`Python worker error: ${err.message || 'Runtime crashed'}`);
    };

    this.pythonWorker = worker;
    this.pythonNotebookId = notebookId;
    return worker;
  }

  private getOrSpawnSqlWorker(notebookId: string): Worker {
    if (this.sqlWorker && this.sqlNotebookId === notebookId) {
      return this.sqlWorker;
    }
    this.terminateSqlKernel();

    const worker = new Worker(new URL('../workers/sql.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (
      event: MessageEvent<{
        type: 'status' | 'result' | 'error';
        requestId: string;
        message?: string;
        stdout?: string;
        stderr?: string;
        tables?: TableOutput[];
        durationMs?: number;
        provider?: string;
      }>
    ) => {
      const data = event.data;
      const cb = this.sqlPending.get(data.requestId);
      if (!cb) return;

      if (data.type === 'status' && data.message) {
        cb.onStatus?.(data.message);
        return;
      }

      this.sqlPending.delete(data.requestId);
      cb.resolve({
        status: data.type === 'error' ? 'error' : 'success',
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        tables: data.tables || [],
        durationMs: data.durationMs ?? 0,
        provider: data.provider || 'DuckDB-Wasm',
        runtimeMessage: undefined,
      });
    };

    worker.onerror = (err) => {
      this.terminateSqlKernel(`SQL worker error: ${err.message || 'Runtime crashed'}`);
    };

    this.sqlWorker = worker;
    this.sqlNotebookId = notebookId;
    return worker;
  }

  public runPython(
    notebookId: string,
    code: string,
    onStatus?: (msg: string) => void,
    onStream?: (stream: 'stdout' | 'stderr', chunk: string) => void
  ): Promise<Partial<BlockExecutionOutput>> {
    return new Promise((resolve) => {
      const worker = this.getOrSpawnPythonWorker(notebookId);
      const requestId = createId();
      this.pythonPending.set(requestId, { resolve, onStatus, onStream });
      worker.postMessage({ type: 'run', requestId, code });
    });
  }

  public runSql(
    notebookId: string,
    code: string,
    onStatus?: (msg: string) => void
  ): Promise<Partial<BlockExecutionOutput>> {
    return new Promise((resolve) => {
      const worker = this.getOrSpawnSqlWorker(notebookId);
      const requestId = createId();
      this.sqlPending.set(requestId, { resolve, onStatus });
      worker.postMessage({ type: 'run', requestId, code });
    });
  }

  public runLatex(code: string): Partial<BlockExecutionOutput> {
    const startedAt = performance.now();
    const cleaned = code
      .trim()
      .replace(/^\$\$\s*/, '')
      .replace(/\s*\$\$$/, '')
      .replace(/^\$\s*/, '')
      .replace(/\s*\$$/, '');

    if (!cleaned) {
      return {
        status: 'success',
        stdout: '',
        stderr: '',
        latexHtml: '',
        durationMs: 0,
        provider: 'KaTeX',
      };
    }

    try {
      const html = katex.renderToString(cleaned, {
        displayMode: true,
        throwOnError: true,
        strict: false,
      });
      return {
        status: 'success',
        stdout: '',
        stderr: '',
        latexHtml: html,
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'KaTeX',
      };
    } catch (err) {
      return {
        status: 'error',
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Invalid LaTeX expression.',
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'KaTeX',
      };
    }
  }

  public async runCpp(
    code: string,
    engine: CppEngine = 'jscpp',
    onStatus?: (msg: string) => void
  ): Promise<Partial<BlockExecutionOutput>> {
    if (engine === 'cloud') {
      return this.runRemoteCompiler('cpp', code, onStatus);
    }

    const startedAt = performance.now();
    onStatus?.('Running C++ in browser (JSCPP)...');

    try {
      const jscppModule = (await import('JSCPP')) as {
        default?: {
          run: (
            code: string,
            input: string,
            config?: {
              stdio?: { write: (s: string) => void };
              maxTimeout?: number;
            }
          ) => number;
        };
        run?: (
          code: string,
          input: string,
          config?: {
            stdio?: { write: (s: string) => void };
            maxTimeout?: number;
          }
        ) => number;
      };

      const JSCPP = jscppModule.default || jscppModule;
      if (!JSCPP || typeof JSCPP.run !== 'function') {
        throw new Error('JSCPP interpreter failed to initialize.');
      }

      let stdout = '';
      const exitCode = JSCPP.run(code, '', {
        stdio: {
          write: (str: string) => {
            stdout += str;
          },
        },
        maxTimeout: 3000,
      });

      return {
        status: 'success',
        stdout: stdout.replace(/\n$/, ''),
        stderr: exitCode !== 0 ? `Process exited with code ${exitCode}` : '',
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'JSCPP (Browser)',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        stdout: '',
        stderr: `${msg}\n\nTip: Switch this cell's C++ engine to "Cloud (GCC)" in the block toolbar for full C++20/STL support.`,
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'JSCPP (Browser)',
      };
    }
  }

  public async runJava(
    code: string,
    precedingBlocks: NotebookBlock[],
    onStatus?: (msg: string) => void
  ): Promise<Partial<BlockExecutionOutput>> {
    // Auto-prepend helper classes defined in earlier Java blocks that do not declare main()
    const helperSnippets = precedingBlocks
      .filter(
        (b) =>
          b.type === 'code' &&
          b.language === 'java' &&
          b.content.trim().length > 0 &&
          !/public\s+static\s+void\s+main\s*\(/.test(b.content)
      )
      .map((b) =>
        b.content
          .replace(/(^|\n)\s*public\s+(final\s+|abstract\s+)?class\s+/g, '$1$2class ')
          .trim()
      );

    let combinedCode = code;
    if (helperSnippets.length > 0) {
      // Extract imports to top so Java syntax remains valid when combining helper classes
      const allSources = [...helperSnippets, code];
      const imports = new Set<string>();
      const bodies = allSources.map((src) =>
        src
          .split('\n')
          .filter((line) => {
            if (/^\s*import\s+[\w.*]+;\s*$/.test(line)) {
              imports.add(line.trim());
              return false;
            }
            return true;
          })
          .join('\n')
      );
      combinedCode = [...Array.from(imports), '', ...bodies].join('\n');
    }

    return this.runRemoteCompiler('java', combinedCode, onStatus);
  }

  private async runRemoteCompiler(
    language: 'cpp' | 'java',
    code: string,
    onStatus?: (msg: string) => void
  ): Promise<Partial<BlockExecutionOutput>> {
    const startedAt = performance.now();
    onStatus?.(language === 'cpp' ? 'Compiling C++20 on cloud runner...' : 'Compiling & running Java...');

    const controller = new AbortController();
    this.activeAbortController = controller;

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code }),
        signal: controller.signal,
      });

      const data = (await res.json()) as {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        provider?: string;
        durationMs?: number;
        error?: string;
      };

      const stderr = data.stderr || data.error || '';
      const hasError = !res.ok || (typeof data.exitCode === 'number' && data.exitCode !== 0);

      return {
        status: hasError ? 'error' : 'success',
        stdout: (data.stdout || '').replace(/\n$/, ''),
        stderr: stderr.replace(/\n$/, ''),
        durationMs: data.durationMs ?? Math.round(performance.now() - startedAt),
        provider: data.provider || 'Cloud Runner',
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          status: 'error',
          stdout: '',
          stderr: 'Execution cancelled.',
          durationMs: Math.round(performance.now() - startedAt),
        };
      }
      return {
        status: 'error',
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Execution request failed.',
        durationMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }
}

export const runtimeManager = new RuntimeManager();
