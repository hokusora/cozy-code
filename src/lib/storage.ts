import { get, set } from 'idb-keyval';
import type { NotebookBlock, NotebookRecord } from '../types';
import { createId } from './crypto';

const WORKSPACE_KEY_STORAGE = 'canvas_notebook_workspace_key';
const IDB_PREFIX = 'canvas_notebook_ws_v1:';

export function normalizeWorkspaceKey(key: string): string {
  return key.trim().toLowerCase();
}

export function getInitialWorkspaceKey(generateFallback: () => string): string {
  const params = new URLSearchParams(window.location.search);
  const urlKey = normalizeWorkspaceKey(params.get('w') || '');
  if (urlKey) {
    localStorage.setItem(WORKSPACE_KEY_STORAGE, urlKey);
    return urlKey;
  }

  const stored = normalizeWorkspaceKey(localStorage.getItem(WORKSPACE_KEY_STORAGE) || '');
  if (stored) {
    return stored;
  }

  const fresh = generateFallback();
  localStorage.setItem(WORKSPACE_KEY_STORAGE, fresh);
  return fresh;
}

export function saveWorkspaceKeyLocal(key: string): void {
  const cleaned = normalizeWorkspaceKey(key);
  if (cleaned) {
    localStorage.setItem(WORKSPACE_KEY_STORAGE, cleaned);
  }
}

export function createBlankNotebook(workspaceId: string, title = 'Untitled Notebook'): NotebookRecord {
  const starterBlock: NotebookBlock = {
    id: createId(),
    type: 'code',
    language: 'python',
    content: '',
    order: 0,
  };

  return {
    id: createId(),
    workspace_id: workspaceId,
    title,
    blocks: [starterBlock],
    updated_at: Date.now(),
    is_deleted: 0,
  };
}

export async function loadLocalNotebooks(workspaceId: string): Promise<NotebookRecord[]> {
  try {
    const cached = await get<NotebookRecord[]>(`${IDB_PREFIX}${workspaceId}`);
    if (Array.isArray(cached)) {
      return cached;
    }
  } catch {
    // IndexedDB unavailable in private browsing or restricted iframe
  }
  return [];
}

export async function saveLocalNotebooks(workspaceId: string, notebooks: NotebookRecord[]): Promise<void> {
  try {
    await set(`${IDB_PREFIX}${workspaceId}`, notebooks);
  } catch {
    // Ignore storage quota / private mode failures
  }
}

/**
 * Last-Write-Wins (LWW) merge comparing `updated_at` timestamps per notebook ID.
 * Only replaces local records when `remote.updated_at > existing.updated_at` to avoid
 * unnecessary editor re-renders while keeping local-unsynced edits intact.
 */
export function mergeNotebooksLWW(
  localList: NotebookRecord[],
  remoteList: NotebookRecord[]
): { merged: NotebookRecord[]; changed: boolean; localNewer: NotebookRecord[] } {
  const byId = new Map<string, NotebookRecord>();
  const remoteById = new Map<string, NotebookRecord>();
  let changed = false;

  for (const nb of localList) {
    byId.set(nb.id, nb);
  }

  for (const remote of remoteList) {
    remoteById.set(remote.id, remote);
    const existing = byId.get(remote.id);
    if (!existing || remote.updated_at > existing.updated_at) {
      byId.set(remote.id, remote);
      changed = true;
    }
  }

  // Identify local records that do not exist on remote or are newer than remote
  const localNewer: NotebookRecord[] = [];
  for (const local of localList) {
    const remote = remoteById.get(local.id);
    if (!remote || local.updated_at > remote.updated_at) {
      localNewer.push(local);
    }
  }

  const merged = Array.from(byId.values()).sort((a, b) => b.updated_at - a.updated_at);
  return { merged, changed, localNewer };
}

export async function fetchRemoteNotebooks(workspaceId: string): Promise<NotebookRecord[] | null> {
  try {
    const res = await fetch(`/api/notebooks?wid=${encodeURIComponent(workspaceId)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { notebooks?: NotebookRecord[] };
    return Array.isArray(data.notebooks) ? data.notebooks : [];
  } catch {
    return null;
  }
}

export async function pushNotebooksToCloud(
  workspaceId: string,
  notebooks: NotebookRecord[],
  options?: { keepalive?: boolean }
): Promise<NotebookRecord[] | null> {
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      keepalive: options?.keepalive ?? false,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        notebooks,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { notebooks?: NotebookRecord[] };
    return Array.isArray(data.notebooks) ? data.notebooks : null;
  } catch {
    return null;
  }
}
