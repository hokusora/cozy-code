/// <reference lib="webworker" />

// Lazy-loaded DuckDB-Wasm Web Worker for stateful in-memory SQL execution.
// A single `:memory:` database instance persists across cells until kernel restart or page refresh.

import * as duckdb from '@duckdb/duckdb-wasm';

let dbInstance: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

async function ensureDuckDb(requestId: string): Promise<duckdb.AsyncDuckDBConnection> {
  if (connection) return connection;

  self.postMessage({
    type: 'status',
    requestId,
    message: 'Loading DuckDB WebAssembly engine...',
  });

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  if (!bundle.mainWorker) {
    throw new Error('Could not resolve DuckDB-Wasm worker bundle.');
  }

  const workerBlob = new Blob([`importScripts("${bundle.mainWorker}");`], {
    type: 'text/javascript',
  });
  const workerUrl = URL.createObjectURL(workerBlob);
  const subWorker = new Worker(workerUrl);

  const logger = new duckdb.VoidLogger();
  dbInstance = new duckdb.AsyncDuckDB(logger, subWorker);
  await dbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await dbInstance.open({ path: ':memory:' });
  connection = await dbInstance.connect();

  URL.revokeObjectURL(workerUrl);
  return connection;
}

function normalizeCellValue(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return Number.isSafeInteger(Number(val)) ? Number(val) : val.toString();
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  if (ArrayBuffer.isView(val)) return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

self.onmessage = async (event: MessageEvent<{ type: string; requestId: string; code?: string }>) => {
  const { type, requestId, code = '' } = event.data;
  if (type !== 'run') return;

  const startedAt = performance.now();

  try {
    const conn = await ensureDuckDb(requestId);
    self.postMessage({ type: 'status', requestId, message: 'Executing SQL query...' });

    const trimmed = code.trim();
    if (!trimmed) {
      self.postMessage({
        type: 'result',
        requestId,
        stdout: '',
        stderr: '',
        tables: [],
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'DuckDB-Wasm (:memory:)',
      });
      return;
    }

    const result = await conn.query(trimmed);
    const schemaFields = result.schema.fields;
    const totalRows = result.numRows;

    if (schemaFields.length === 0) {
      self.postMessage({
        type: 'result',
        requestId,
        stdout: 'Statement executed successfully.',
        stderr: '',
        tables: [],
        durationMs: Math.round(performance.now() - startedAt),
        provider: 'DuckDB-Wasm (:memory:)',
      });
      return;
    }

    const columns = schemaFields.map((f) => f.name);
    const maxRows = 300;
    const limit = Math.min(totalRows, maxRows);
    const rows: Array<Array<string | number | boolean | null>> = [];

    for (let r = 0; r < limit; r++) {
      const rowValues: Array<string | number | boolean | null> = [];
      for (let c = 0; c < columns.length; c++) {
        const colVec = result.getChildAt(c);
        rowValues.push(normalizeCellValue(colVec ? colVec.get(r) : null));
      }
      rows.push(rowValues);
    }

    const isDdlSummary =
      columns.length === 1 &&
      (columns[0] === 'Count' || columns[0] === 'Success') &&
      totalRows <= 1 &&
      !/^\s*(select|with|show|describe|pragma|explain|values|table)\b/i.test(trimmed);

    self.postMessage({
      type: 'result',
      requestId,
      stdout: isDdlSummary
        ? `Query executed (${rows[0]?.[0] ?? 'OK'}).`
        : totalRows === 0
          ? 'Query returned 0 rows.'
          : '',
      stderr: '',
      tables: isDdlSummary
        ? []
        : [
            {
              columns,
              rows,
              rowCount: totalRows,
              truncated: totalRows > maxRows,
            },
          ],
      durationMs: Math.round(performance.now() - startedAt),
      provider: 'DuckDB-Wasm (:memory:)',
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startedAt),
      provider: 'DuckDB-Wasm (:memory:)',
    });
  }
};
