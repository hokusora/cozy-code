// Cloudflare Pages Function: GET & POST /api/sync (Cloudflare D1)
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

interface Env {
  DB: D1Database;
}

interface DbRow {
  id: string;
  workspace_id: string;
  title: string;
  blocks_json: string;
  updated_at: number;
  is_deleted: number;
}

function formatRow(row: DbRow) {
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

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const url = new URL(context.request.url);
  const wid = (url.searchParams.get('wid') || '').trim();
  if (!wid || wid.length > 128) {
    return Response.json({ error: 'Missing or invalid workspace_id (wid).' }, { status: 400 });
  }

  const { results } = await context.env.DB.prepare(
    'SELECT id, workspace_id, title, blocks_json, updated_at, is_deleted FROM notebooks WHERE workspace_id = ? ORDER BY updated_at DESC'
  )
    .bind(wid)
    .all<DbRow>();

  return Response.json({
    notebooks: (results || []).map(formatRow),
    serverTime: Date.now(),
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const body = (await context.request.json().catch(() => null)) as {
    workspace_id?: string;
    notebooks?: Array<{
      id: string;
      title: string;
      blocks: unknown[];
      updated_at: number;
      is_deleted?: number;
    }>;
  } | null;

  if (!body?.workspace_id || !Array.isArray(body.notebooks)) {
    return Response.json({ error: 'Invalid sync payload.' }, { status: 400 });
  }

  const wid = body.workspace_id.trim();
  const statements: D1PreparedStatement[] = [];

  for (const nb of body.notebooks) {
    if (!nb?.id || typeof nb.title !== 'string') continue;
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO notebooks (id, workspace_id, title, blocks_json, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           blocks_json = excluded.blocks_json,
           updated_at = excluded.updated_at,
           is_deleted = excluded.is_deleted
         WHERE excluded.updated_at >= notebooks.updated_at
           AND notebooks.workspace_id = excluded.workspace_id`
      ).bind(
        nb.id,
        wid,
        nb.title.slice(0, 200),
        JSON.stringify(Array.isArray(nb.blocks) ? nb.blocks : []),
        typeof nb.updated_at === 'number' ? nb.updated_at : Date.now(),
        nb.is_deleted ? 1 : 0
      )
    );
  }

  if (statements.length > 0) {
    await context.env.DB.batch(statements);
  }

  const { results } = await context.env.DB.prepare(
    'SELECT id, workspace_id, title, blocks_json, updated_at, is_deleted FROM notebooks WHERE workspace_id = ? ORDER BY updated_at DESC'
  )
    .bind(wid)
    .all<DbRow>();

  return Response.json({
    ok: true,
    syncedCount: statements.length,
    notebooks: (results || []).map(formatRow),
    serverTime: Date.now(),
  });
};
