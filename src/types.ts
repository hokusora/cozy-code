export type BlockType = 'code' | 'text';

export type CodeLanguage = 'python' | 'sql' | 'cpp' | 'java' | 'latex';

export type CppEngine = 'jscpp' | 'cloud';

export interface NotebookBlock {
  id: string;
  type: BlockType;
  language: CodeLanguage;
  content: string;
  order: number;
  engine?: CppEngine;
}

export interface NotebookRecord {
  id: string;
  workspace_id: string;
  title: string;
  blocks: NotebookBlock[];
  updated_at: number;
  is_deleted: number;
}

export interface TableOutput {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  truncated?: boolean;
}

export interface BlockExecutionOutput {
  status: 'idle' | 'loading-runtime' | 'running' | 'success' | 'error';
  executionCount: number | null;
  durationMs: number | null;
  stdout: string;
  stderr: string;
  tables?: TableOutput[];
  images?: string[]; // base64 data URIs (e.g. Matplotlib PNG)
  latexHtml?: string;
  provider?: string;
  runtimeMessage?: string;
  collapsed?: boolean;
}

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export type KernelStatus = 'idle' | 'booting' | 'ready' | 'running';
