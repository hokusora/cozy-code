import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Initialize local SQLite database using identical schema to Cloudflare D1 (schema.sql)
const dbPath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || './data/canvas-notebook.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    blocks_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_workspace ON notebooks(workspace_id, updated_at);
`);

interface DbNotebookRow {
  id: string;
  workspace_id: string;
  title: string;
  blocks_json: string;
  updated_at: number;
  is_deleted: number;
}

const selectByWorkspaceStmt = db.prepare<string, DbNotebookRow>(
  `SELECT id, workspace_id, title, blocks_json, updated_at, is_deleted
   FROM notebooks
   WHERE workspace_id = ?
   ORDER BY updated_at DESC`
);

const upsertLwwStmt = db.prepare(`
  INSERT INTO notebooks (id, workspace_id, title, blocks_json, updated_at, is_deleted)
  VALUES (@id, @workspace_id, @title, @blocks_json, @updated_at, @is_deleted)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    blocks_json = excluded.blocks_json,
    updated_at = excluded.updated_at,
    is_deleted = excluded.is_deleted
  WHERE excluded.updated_at >= notebooks.updated_at
    AND notebooks.workspace_id = excluded.workspace_id
`);

const syncTransaction = db.transaction((rows: DbNotebookRow[]) => {
  for (const row of rows) {
    upsertLwwStmt.run(row);
  }
});

// Cache Wandbox compiler resolution in memory
let wandboxCompilersCache: { cpp: string; java: string; fetchedAt: number } | null = null;

async function resolveWandboxCompilers(): Promise<{ cpp: string; java: string }> {
  if (wandboxCompilersCache && Date.now() - wandboxCompilersCache.fetchedAt < 3600_000) {
    return { cpp: wandboxCompilersCache.cpp, java: wandboxCompilersCache.java };
  }
  try {
    const res = await fetch('https://wandbox.org/api/list.json', {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const list = (await res.json()) as Array<{ name: string; language: string }>;
      const cppMatch =
        list.find((c) => c.name === 'gcc-head') ||
        list.find((c) => c.language === 'C++' && c.name.startsWith('gcc-')) ||
        list.find((c) => c.language === 'C++');
      const javaMatch =
        list.find((c) => c.name === 'openjdk-head') ||
        list.find((c) => c.language.toLowerCase() === 'java' && c.name.startsWith('openjdk')) ||
        list.find((c) => c.language.toLowerCase() === 'java');

      const resolved = {
        cpp: cppMatch?.name || 'gcc-head',
        java: javaMatch?.name || 'openjdk-head',
        fetchedAt: Date.now(),
      };
      wandboxCompilersCache = resolved;
      return { cpp: resolved.cpp, java: resolved.java };
    }
  } catch {
    // Fallback to standard Wandbox compiler identifiers
  }
  return { cpp: 'gcc-head', java: 'openjdk-head' };
}

function normalizeJavaForWandbox(source: string): string {
  // Wandbox compiles Java inside prog.java; top-level `public class X` triggers
  // a filename mismatch unless `public` is removed from top-level class declarations.
  return source.replace(/(^|\n)\s*public\s+(final\s+|abstract\s+)?class\s+/g, '$1$2class ');
}

async function executeViaPiston(
  pistonUrl: string,
  language: 'cpp' | 'java',
  code: string,
  stdin: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PISTON_API_KEY) {
    headers['Authorization'] = process.env.PISTON_API_KEY;
  }

  const filename = language === 'java' ? 'Main.java' : 'main.cpp';
  const res = await fetch(pistonUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language: language === 'cpp' ? 'c++' : 'java',
      version: '*',
      files: [{ name: filename, content: code }],
      stdin,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Piston API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    compile?: { stdout?: string; stderr?: string; code?: number };
    run?: { stdout?: string; stderr?: string; code?: number };
  };

  const compileErr = data.compile?.stderr || '';
  const runOut = data.run?.stdout || '';
  const runErr = data.run?.stderr || '';
  const stderr = [compileErr, runErr].filter(Boolean).join('\n');
  const exitCode = data.compile?.code && data.compile.code !== 0 ? data.compile.code : (data.run?.code ?? 0);

  return { stdout: runOut, stderr, exitCode, provider: 'Piston API' };
}

async function executeViaWandbox(language: 'cpp' | 'java', code: string, stdin: string) {
  const compilers = await resolveWandboxCompilers();
  const compiler = language === 'cpp' ? compilers.cpp : compilers.java;
  const preparedCode = language === 'java' ? normalizeJavaForWandbox(code) : code;

  const payload: Record<string, unknown> = {
    compiler,
    code: preparedCode,
    stdin,
    save: false,
  };
  if (language === 'cpp') {
    payload.options = 'warning,c++20';
  }

  const res = await fetch('https://wandbox.org/api/compile.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Wandbox compiler error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    status?: string;
    compiler_error?: string;
    compiler_message?: string;
    program_output?: string;
    program_error?: string;
    signal?: string;
  };

  const stdout = data.program_output || '';
  const stderrParts = [data.compiler_error, data.program_error].filter(Boolean);
  if (data.signal) {
    stderrParts.push(`Terminated by signal: ${data.signal}`);
  }
  const exitCode = Number(data.status ?? (stderrParts.length > 0 && !stdout ? 1 : 0));

  return {
    stdout,
    stderr: stderrParts.join('\n'),
    exitCode: Number.isNaN(exitCode) ? 0 : exitCode,
    provider: `Wandbox (${compiler})`,
  };
}

function formatRow(row: DbNotebookRow) {
  let blocks = [];
  try {
    blocks = JSON.parse(row.blocks_json);
  } catch {
    blocks = [];
  }
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    blocks,
    updated_at: row.updated_at,
    is_deleted: row.is_deleted,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // GET /api/notebooks?wid={workspace_id} (and alias /api/sync)
  const handleGetNotebooks: express.RequestHandler = (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const wid = String(req.query.wid || '').trim();
    if (!wid || wid.length > 128) {
      res.status(400).json({ error: 'Missing or invalid workspace_id (wid).' });
      return;
    }

    try {
      const rows = selectByWorkspaceStmt.all(wid);
      res.json({
        notebooks: rows.map(formatRow),
        serverTime: Date.now(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Database read failed.' });
    }
  };

  app.get('/api/notebooks', handleGetNotebooks);
  app.get('/api/sync', handleGetNotebooks);

  // POST /api/sync — LWW batch upsert
  app.post('/api/sync', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { workspace_id, notebooks } = req.body || {};
    if (typeof workspace_id !== 'string' || !workspace_id.trim() || !Array.isArray(notebooks)) {
      res.status(400).json({ error: 'Invalid sync payload. Expected workspace_id and notebooks array.' });
      return;
    }

    const wid = workspace_id.trim();
    const validRows: DbNotebookRow[] = [];

    for (const nb of notebooks) {
      if (!nb || typeof nb.id !== 'string' || typeof nb.title !== 'string') continue;
      validRows.push({
        id: nb.id,
        workspace_id: wid,
        title: nb.title.slice(0, 200),
        blocks_json: JSON.stringify(Array.isArray(nb.blocks) ? nb.blocks : []),
        updated_at: typeof nb.updated_at === 'number' ? nb.updated_at : Date.now(),
        is_deleted: nb.is_deleted ? 1 : 0,
      });
    }

    try {
      if (validRows.length > 0) {
        syncTransaction(validRows);
      }
      const latestRows = selectByWorkspaceStmt.all(wid);
      res.json({
        ok: true,
        syncedCount: validRows.length,
        notebooks: latestRows.map(formatRow),
        serverTime: Date.now(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Database sync failed.' });
    }
  });

  // POST /api/execute — Server-side proxy for C++ (full STL) and Java
  app.post('/api/execute', async (req, res) => {
    const { language, code, stdin = '' } = req.body || {};
    if ((language !== 'cpp' && language !== 'java') || typeof code !== 'string') {
      res.status(400).json({ error: 'Invalid execution request. Expected language (cpp|java) and code.' });
      return;
    }

    const startedAt = Date.now();
    const pistonUrl = (process.env.PISTON_API_URL || '').trim();

    try {
      let result;
      if (pistonUrl) {
        try {
          result = await executeViaPiston(pistonUrl, language, code, String(stdin));
        } catch {
          result = await executeViaWandbox(language, code, String(stdin));
        }
      } else {
        result = await executeViaWandbox(language, code, String(stdin));
      }

      res.json({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      res.status(502).json({
        stdout: '',
        stderr:
          err instanceof Error
            ? `Remote execution unavailable: ${err.message}`
            : 'Remote execution unavailable.',
        exitCode: 1,
        provider: 'Unavailable',
        durationMs: Date.now() - startedAt,
      });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Canvas Notebook server listening on http://localhost:${PORT}`);
  });
}

startServer();
