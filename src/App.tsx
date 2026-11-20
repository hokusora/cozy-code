import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, FilePlus2 } from 'lucide-react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { CodeBlock } from './components/CodeBlock';
import { TextBlock } from './components/TextBlock';
import { InsertDivider } from './components/InsertDivider';
import { createId, generateWorkspaceKey, hashWorkspaceKey } from './lib/crypto';
import {
  createBlankNotebook,
  fetchRemoteNotebooks,
  getInitialWorkspaceKey,
  loadLocalNotebooks,
  mergeNotebooksLWW,
  pushNotebooksToCloud,
  saveLocalNotebooks,
  saveWorkspaceKeyLocal,
} from './lib/storage';
import { runtimeManager } from './lib/runners';
import type {
  BlockExecutionOutput,
  BlockType,
  CodeLanguage,
  CppEngine,
  NotebookBlock,
  NotebookRecord,
  SyncState,
} from './types';

export default function App() {
  const [workspaceKey, setWorkspaceKey] = useState<string>(() =>
    getInitialWorkspaceKey(generateWorkspaceKey)
  );
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [notebooks, setNotebooks] = useState<NotebookRecord[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string>('');
  const [isHydrating, setIsHydrating] = useState<boolean>(true);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  // Sync status
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Ephemeral RAM-only outputs (strictly cleared on page refresh)
  const [outputsByBlockId, setOutputsByBlockId] = useState<Record<string, BlockExecutionOutput>>({});
  const [isRunningAll, setIsRunningAll] = useState<boolean>(false);
  const [hasActiveKernel, setHasActiveKernel] = useState<boolean>(false);
  const [newlyAddedBlockId, setNewlyAddedBlockId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const executionCounterRef = useRef<number>(0);
  const runAllCancelledRef = useRef<boolean>(false);
  // Maps dirty notebook id -> latest local updated_at timestamp queued for sync
  const dirtyNotebooksRef = useRef<Map<string, number>>(new Map());
  const syncTimerRef = useRef<number | null>(null);
  const isPullingRef = useRef<boolean>(false);
  const notebooksRef = useRef<NotebookRecord[]>(notebooks);
  notebooksRef.current = notebooks;
  const workspaceIdRef = useRef<string>(workspaceId);
  workspaceIdRef.current = workspaceId;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2800);
  }, []);

  // Flush dirty notebooks to cloud immediately (supports keepalive on pagehide/visibilitychange)
  const flushCloudSync = useCallback(
    async (options?: { keepalive?: boolean; targetWid?: string; pullAfter?: boolean }) => {
      const wid = options?.targetWid || workspaceIdRef.current;
      if (!wid) return;

      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      const dirtyMap = dirtyNotebooksRef.current;
      const snapshotTimestamps = new Map(dirtyMap);
      const toSync = notebooksRef.current.filter((nb) => snapshotTimestamps.has(nb.id));

      if (toSync.length === 0) {
        if (options?.pullAfter && !isPullingRef.current) {
          isPullingRef.current = true;
          setSyncState('syncing');
          try {
            const remoteList = await fetchRemoteNotebooks(wid);
            if (remoteList !== null && workspaceIdRef.current === wid) {
              const { merged, changed } = mergeNotebooksLWW(notebooksRef.current, remoteList);
              if (changed) {
                setNotebooks(merged);
                await saveLocalNotebooks(wid, merged);
              }
              setSyncState('synced');
              setLastSyncedAt(Date.now());
            } else if (remoteList === null) {
              setSyncState(navigator.onLine ? 'error' : 'offline');
            }
          } finally {
            isPullingRef.current = false;
          }
        }
        return;
      }

      setSyncState('syncing');
      const remoteLatest = await pushNotebooksToCloud(wid, toSync, {
        keepalive: options?.keepalive,
      });

      if (remoteLatest) {
        // Only clear dirty entries whose local timestamp hasn't advanced while push was in flight
        for (const [id, pushedTs] of snapshotTimestamps.entries()) {
          const currentTs = dirtyMap.get(id);
          if (currentTs !== undefined && currentTs <= pushedTs) {
            dirtyMap.delete(id);
          }
        }

        if (workspaceIdRef.current === wid) {
          const { merged, changed } = mergeNotebooksLWW(notebooksRef.current, remoteLatest);
          if (changed) {
            setNotebooks(merged);
            await saveLocalNotebooks(wid, merged);
          }
          setSyncState('synced');
          setLastSyncedAt(Date.now());
        }
      } else {
        setSyncState(navigator.onLine ? 'error' : 'offline');
      }
    },
    []
  );

  // Debounced cloud sync (1000ms) for modified notebooks
  const scheduleCloudSync = useCallback(
    (dirtyIds?: string[]) => {
      if (dirtyIds) {
        for (const id of dirtyIds) {
          const matched = notebooksRef.current.find((nb) => nb.id === id);
          dirtyNotebooksRef.current.set(id, matched?.updated_at ?? Date.now());
        }
      }
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }

      syncTimerRef.current = window.setTimeout(() => {
        void flushCloudSync();
      }, 1000);
    },
    [flushCloudSync]
  );

  // Pull latest remote notebooks and merge safely via LWW
  const pullRemoteUpdates = useCallback(async () => {
    const wid = workspaceIdRef.current;
    if (!wid || isPullingRef.current) return;

    // If local edits are waiting to push, flush first instead of pulling stale state
    if (dirtyNotebooksRef.current.size > 0) {
      await flushCloudSync();
      return;
    }

    isPullingRef.current = true;
    try {
      const remoteList = await fetchRemoteNotebooks(wid);
      if (remoteList === null || workspaceIdRef.current !== wid) {
        if (remoteList === null) {
          setSyncState(navigator.onLine ? 'error' : 'offline');
        }
        return;
      }

      const { merged, changed, localNewer } = mergeNotebooksLWW(notebooksRef.current, remoteList);

      if (changed) {
        setNotebooks(merged);
        await saveLocalNotebooks(wid, merged);
        setActiveNotebookId((prev) => {
          const visible = merged.filter((nb) => !nb.is_deleted);
          return visible.some((nb) => nb.id === prev) ? prev : visible[0]?.id || '';
        });
      }

      if (localNewer.length > 0) {
        await pushNotebooksToCloud(wid, localNewer);
      }

      setSyncState('synced');
      setLastSyncedAt(Date.now());
    } finally {
      isPullingRef.current = false;
    }
  }, [flushCloudSync]);

  // Hydrate workspace whenever workspaceKey changes
  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkspace() {
      setIsHydrating(true);
      runtimeManager.abortAll();
      setHasActiveKernel(false);
      setOutputsByBlockId({});
      executionCounterRef.current = 0;
      dirtyNotebooksRef.current.clear();

      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      const wid = await hashWorkspaceKey(workspaceKey);
      if (cancelled) return;
      setWorkspaceId(wid);
      workspaceIdRef.current = wid;

      // 1. Instant local paint from IndexedDB
      const localList = await loadLocalNotebooks(wid);
      if (cancelled) return;

      const activeLocal = localList.filter((nb) => !nb.is_deleted);
      if (activeLocal.length > 0) {
        setNotebooks(localList);
        setActiveNotebookId(activeLocal[0].id);
        setIsHydrating(false);
      }

      // 2. Fetch remote D1/SQLite state and merge via Last-Write-Wins
      setSyncState('syncing');
      const remoteList = await fetchRemoteNotebooks(wid);
      if (cancelled) return;

      if (remoteList !== null) {
        const { merged: initialMerged, localNewer } = mergeNotebooksLWW(localList, remoteList);
        let merged = initialMerged;
        let visible = merged.filter((nb) => !nb.is_deleted);

        // Brand-new empty workspace: seed single blank notebook with one Python cell
        if (visible.length === 0) {
          const starter = createBlankNotebook(wid, 'Untitled Notebook');
          merged = [starter, ...merged];
          visible = [starter];
          await saveLocalNotebooks(wid, merged);
          setNotebooks(merged);
          setActiveNotebookId(starter.id);
          await pushNotebooksToCloud(wid, [starter]);
        } else {
          await saveLocalNotebooks(wid, merged);
          setNotebooks(merged);
          setActiveNotebookId((prev) =>
            visible.some((nb) => nb.id === prev) ? prev : visible[0].id
          );
          // Push any local-only or newer local edits up to the cloud immediately
          if (localNewer.length > 0) {
            await pushNotebooksToCloud(wid, localNewer);
          }
        }

        setSyncState('synced');
        setLastSyncedAt(Date.now());
      } else {
        // Offline fallback: ensure at least one blank notebook exists locally
        if (activeLocal.length === 0) {
          const starter = createBlankNotebook(wid, 'Untitled Notebook');
          const next = [starter, ...localList];
          await saveLocalNotebooks(wid, next);
          setNotebooks(next);
          setActiveNotebookId(starter.id);
        }
        setSyncState('offline');
      }

      setIsHydrating(false);
    }

    hydrateWorkspace();

    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);

  // Cross-device live sync: flush on tab hide/close, pull on focus/return and 5s interval
  useEffect(() => {
    const handleOnline = () => {
      if (dirtyNotebooksRef.current.size > 0) {
        void flushCloudSync({ pullAfter: true });
      } else {
        void pullRemoteUpdates();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (dirtyNotebooksRef.current.size > 0) {
          void flushCloudSync({ keepalive: true });
        }
      } else if (document.visibilityState === 'visible') {
        void pullRemoteUpdates();
      }
    };

    const handleFocus = () => {
      void pullRemoteUpdates();
    };

    const handlePageHide = () => {
      if (dirtyNotebooksRef.current.size > 0) {
        void flushCloudSync({ keepalive: true });
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pullRemoteUpdates();
      }
    }, 5000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushCloudSync, pullRemoteUpdates]);

  // Enforce 1-active-Pyodide-worker limit when switching notebooks
  useEffect(() => {
    if (!activeNotebookId) return;
    runtimeManager.syncActiveNotebook(activeNotebookId);
    setHasActiveKernel(runtimeManager.isPythonActive() || runtimeManager.isSqlActive());
  }, [activeNotebookId]);

  const activeNotebook = useMemo(
    () => notebooks.find((nb) => nb.id === activeNotebookId && !nb.is_deleted) || null,
    [notebooks, activeNotebookId]
  );

  const persistMutation = useCallback(
    (updater: (prev: NotebookRecord[]) => NotebookRecord[], dirtyIds: string[]) => {
      setNotebooks((prev) => {
        const next = updater(prev);
        notebooksRef.current = next;
        if (workspaceIdRef.current) {
          void saveLocalNotebooks(workspaceIdRef.current, next);
        }
        for (const id of dirtyIds) {
          const matched = next.find((nb) => nb.id === id);
          dirtyNotebooksRef.current.set(id, matched?.updated_at ?? Date.now());
        }
        return next;
      });
      scheduleCloudSync();
    },
    [scheduleCloudSync]
  );

  const handleChangeWorkspaceKey = useCallback(
    async (newKey: string) => {
      const cleaned = newKey.trim().toLowerCase();
      if (!cleaned || cleaned === workspaceKey) return;
      if (dirtyNotebooksRef.current.size > 0) {
        await flushCloudSync({ keepalive: true });
      }
      saveWorkspaceKeyLocal(cleaned);
      const url = new URL(window.location.href);
      url.searchParams.set('w', cleaned);
      window.history.replaceState({}, '', url.toString());
      setWorkspaceKey(cleaned);
    },
    [flushCloudSync, workspaceKey]
  );

  const handleSyncNow = useCallback(() => {
    void flushCloudSync({ pullAfter: true });
  }, [flushCloudSync]);

  const handleCreateNotebook = useCallback(() => {
    const wid = workspaceIdRef.current;
    if (!wid) return;
    const count = notebooksRef.current.filter((nb) => !nb.is_deleted).length;
    const title = count === 0 ? 'Untitled Notebook' : `Untitled Notebook ${count + 1}`;
    const nb = createBlankNotebook(wid, title);
    persistMutation((prev) => [nb, ...prev], [nb.id]);
    setActiveNotebookId(nb.id);
    setNewlyAddedBlockId(nb.blocks[0]?.id || null);
  }, [persistMutation]);

  const handleRenameNotebook = useCallback(
    (id: string, newTitle: string) => {
      const cleaned = newTitle.trim() || 'Untitled Notebook';
      persistMutation(
        (prev) =>
          prev.map((nb) =>
            nb.id === id ? { ...nb, title: cleaned, updated_at: Date.now() } : nb
          ),
        [id]
      );
    },
    [persistMutation]
  );

  const handleDeleteNotebook = useCallback(
    (id: string) => {
      const now = Date.now();
      const remaining = notebooksRef.current.filter((nb) => !nb.is_deleted && nb.id !== id);

      if (remaining.length === 0 && workspaceIdRef.current) {
        const replacement = createBlankNotebook(workspaceIdRef.current, 'Untitled Notebook');
        persistMutation(
          (prev) => [
            replacement,
            ...prev.map((nb) =>
              nb.id === id ? { ...nb, is_deleted: 1, updated_at: now } : nb
            ),
          ],
          [id, replacement.id]
        );
        setActiveNotebookId(replacement.id);
      } else {
        persistMutation(
          (prev) =>
            prev.map((nb) =>
              nb.id === id ? { ...nb, is_deleted: 1, updated_at: now } : nb
            ),
          [id]
        );
        if (activeNotebookId === id && remaining.length > 0) {
          setActiveNotebookId(remaining[0].id);
        }
      }
    },
    [activeNotebookId, persistMutation]
  );

  const mutateActiveBlocks = useCallback(
    (transform: (blocks: NotebookBlock[]) => NotebookBlock[]) => {
      if (!activeNotebook) return;
      const nbId = activeNotebook.id;
      persistMutation(
        (prev) =>
          prev.map((nb) => {
            if (nb.id !== nbId) return nb;
            const nextBlocks = transform(nb.blocks).map((b, idx) => ({ ...b, order: idx }));
            return {
              ...nb,
              blocks: nextBlocks,
              updated_at: Date.now(),
            };
          }),
        [nbId]
      );
    },
    [activeNotebook, persistMutation]
  );

  const handleInsertBlock = useCallback(
    (index: number, type: BlockType) => {
      const newBlock: NotebookBlock = {
        id: createId(),
        type,
        language: 'python',
        content: '',
        order: index,
      };
      mutateActiveBlocks((blocks) => {
        const copy = [...blocks];
        copy.splice(index, 0, newBlock);
        return copy;
      });
      setNewlyAddedBlockId(newBlock.id);
    },
    [mutateActiveBlocks]
  );

  const handleUpdateBlockContent = useCallback(
    (blockId: string, content: string) => {
      mutateActiveBlocks((blocks) =>
        blocks.map((b) => (b.id === blockId ? { ...b, content } : b))
      );
    },
    [mutateActiveBlocks]
  );

  const handleChangeBlockLanguage = useCallback(
    (blockId: string, language: CodeLanguage) => {
      mutateActiveBlocks((blocks) =>
        blocks.map((b) =>
          b.id === blockId
            ? { ...b, language, engine: language === 'cpp' ? b.engine || 'jscpp' : undefined }
            : b
        )
      );
    },
    [mutateActiveBlocks]
  );

  const handleChangeCppEngine = useCallback(
    (blockId: string, engine: CppEngine) => {
      mutateActiveBlocks((blocks) =>
        blocks.map((b) => (b.id === blockId ? { ...b, engine } : b))
      );
    },
    [mutateActiveBlocks]
  );

  const handleMoveBlock = useCallback(
    (index: number, direction: -1 | 1) => {
      mutateActiveBlocks((blocks) => {
        const target = index + direction;
        if (target < 0 || target >= blocks.length) return blocks;
        const copy = [...blocks];
        const [item] = copy.splice(index, 1);
        copy.splice(target, 0, item);
        return copy;
      });
    },
    [mutateActiveBlocks]
  );

  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      mutateActiveBlocks((blocks) => blocks.filter((b) => b.id !== blockId));
      setOutputsByBlockId((prev) => {
        if (!(blockId in prev)) return prev;
        const copy = { ...prev };
        delete copy[blockId];
        return copy;
      });
    },
    [mutateActiveBlocks]
  );

  // Execute a single code block
  const runBlock = useCallback(
    async (block: NotebookBlock): Promise<'success' | 'error'> => {
      if (!activeNotebook || block.type !== 'code') return 'success';

      const nbId = activeNotebook.id;
      executionCounterRef.current += 1;
      const execCount = executionCounterRef.current;

      setOutputsByBlockId((prev) => ({
        ...prev,
        [block.id]: {
          status: block.language === 'python' || block.language === 'sql' ? 'loading-runtime' : 'running',
          executionCount: execCount,
          durationMs: null,
          stdout: '',
          stderr: '',
          tables: [],
          images: [],
          latexHtml: undefined,
          runtimeMessage:
            block.language === 'python'
              ? 'Preparing Python runtime...'
              : block.language === 'sql'
                ? 'Preparing DuckDB-Wasm engine...'
                : 'Executing...',
          collapsed: false,
        },
      }));

      const onStatus = (msg: string) => {
        setOutputsByBlockId((prev) => {
          const curr = prev[block.id];
          if (!curr) return prev;
          return {
            ...prev,
            [block.id]: {
              ...curr,
              status: msg.toLowerCase().includes('loading') || msg.toLowerCase().includes('installing')
                ? 'loading-runtime'
                : 'running',
              runtimeMessage: msg,
            },
          };
        });
      };

      const onStream = (stream: 'stdout' | 'stderr', chunk: string) => {
        setOutputsByBlockId((prev) => {
          const curr = prev[block.id];
          if (!curr) return prev;
          return {
            ...prev,
            [block.id]: {
              ...curr,
              status: 'running',
              [stream]: curr[stream] + chunk,
            },
          };
        });
      };

      let result: Partial<BlockExecutionOutput>;

      if (block.language === 'python') {
        result = await runtimeManager.runPython(nbId, block.content, onStatus, onStream);
      } else if (block.language === 'sql') {
        result = await runtimeManager.runSql(nbId, block.content, onStatus);
      } else if (block.language === 'latex') {
        result = runtimeManager.runLatex(block.content);
      } else if (block.language === 'cpp') {
        result = await runtimeManager.runCpp(block.content, block.engine || 'jscpp', onStatus);
      } else {
        const blockIdx = activeNotebook.blocks.findIndex((b) => b.id === block.id);
        const preceding = blockIdx > 0 ? activeNotebook.blocks.slice(0, blockIdx) : [];
        result = await runtimeManager.runJava(block.content, preceding, onStatus);
      }

      setHasActiveKernel(runtimeManager.isPythonActive() || runtimeManager.isSqlActive());

      const finalStatus = result.status === 'error' ? 'error' : 'success';
      setOutputsByBlockId((prev) => ({
        ...prev,
        [block.id]: {
          status: finalStatus,
          executionCount: execCount,
          durationMs: result.durationMs ?? 0,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          tables: result.tables ?? [],
          images: result.images ?? [],
          latexHtml: result.latexHtml,
          provider: result.provider,
          runtimeMessage: undefined,
          collapsed: false,
        },
      }));

      return finalStatus;
    },
    [activeNotebook]
  );

  const handleRunAll = useCallback(async () => {
    if (!activeNotebook) return;
    runAllCancelledRef.current = false;
    setIsRunningAll(true);

    try {
      const codeBlocks = activeNotebook.blocks.filter((b) => b.type === 'code');
      for (const block of codeBlocks) {
        if (runAllCancelledRef.current) break;
        const status = await runBlock(block);
        if (status === 'error' || runAllCancelledRef.current) {
          break;
        }
      }
    } finally {
      setIsRunningAll(false);
    }
  }, [activeNotebook, runBlock]);

  const handleStopOrRestartKernel = useCallback(() => {
    runAllCancelledRef.current = true;
    setIsRunningAll(false);
    runtimeManager.abortAll('Execution stopped and kernel restarted.');
    setHasActiveKernel(false);
    executionCounterRef.current = 0;
    showToast('Kernel restarted — WebAssembly memory cleared');
  }, [showToast]);

  const handleClearAllOutputs = useCallback(() => {
    setOutputsByBlockId({});
    executionCounterRef.current = 0;
  }, []);

  const isRunningAny = useMemo(() => {
    if (isRunningAll) return true;
    return Object.values(outputsByBlockId).some(
      (out) => out.status === 'running' || out.status === 'loading-runtime'
    );
  }, [isRunningAll, outputsByBlockId]);

  const activeBlockIdsWithOutput = useMemo(() => {
    if (!activeNotebook) return 0;
    return activeNotebook.blocks.filter((b) => Boolean(outputsByBlockId[b.id])).length;
  }, [activeNotebook, outputsByBlockId]);

  return (
    <div className="h-screen flex flex-col bg-[#131314] text-[#E3E3E3] overflow-hidden">
      <Header
        workspaceKey={workspaceKey}
        onChangeWorkspaceKey={(key) => void handleChangeWorkspaceKey(key)}
        onSyncNow={handleSyncNow}
        syncState={syncState}
        lastSyncedAt={lastSyncedAt}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        isRunningAny={isRunningAny}
        onRunAll={handleRunAll}
        onStopOrRestartKernel={handleStopOrRestartKernel}
        hasActiveKernel={hasActiveKernel}
      />

      <div className="flex-1 flex min-h-0 relative">
        <Sidebar
          open={sidebarOpen}
          notebooks={notebooks}
          activeNotebookId={activeNotebookId}
          onSelectNotebook={(id) => {
            setActiveNotebookId(id);
            setNewlyAddedBlockId(null);
          }}
          onCreateNotebook={handleCreateNotebook}
          onRenameNotebook={handleRenameNotebook}
          onDeleteNotebook={handleDeleteNotebook}
          onCloseMobile={() => {
            if (window.innerWidth < 768) {
              setSidebarOpen(false);
            }
          }}
        />

        {/* Main Notebook Canvas */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-[#131314]">
          {isHydrating ? (
            <div className="max-w-[960px] mx-auto px-6 py-10 space-y-6">
              <div className="h-8 w-64 rounded-lg bg-[#1E1F20] animate-pulse" />
              <div className="h-44 w-full rounded-xl bg-[#1E1F20] border border-[#333537] animate-pulse" />
            </div>
          ) : activeNotebook ? (
            <div className="max-w-[960px] mx-auto px-4 sm:px-8 pt-8 pb-28">
              {/* Editable Notebook Title Header */}
              <div className="mb-6 pb-4 border-b border-[#333537]/70 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={activeNotebook.title}
                    onChange={(e) => handleRenameNotebook(activeNotebook.id, e.target.value)}
                    aria-label="Notebook title"
                    placeholder="Untitled Notebook"
                    className="w-full bg-transparent font-display text-2xl sm:text-[28px] font-semibold tracking-tight text-[#E3E3E3] placeholder-[#8E918F] focus:outline-none focus:ring-0"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#C4C7C5]/80 font-mono-code">
                    <span>
                      {activeNotebook.blocks.length}{' '}
                      {activeNotebook.blocks.length === 1 ? 'block' : 'blocks'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {hasActiveKernel ? 'Active Wasm kernel' : 'Kernel idle (lazy-loaded)'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Workspace: {workspaceKey}</span>
                  </div>
                </div>

                {activeBlockIdsWithOutput > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllOutputs}
                    className="self-start sm:self-auto h-8 px-3 rounded-lg text-xs font-medium text-[#C4C7C5] hover:text-[#E3E3E3] bg-[#1E1F20] hover:bg-[#282A2C] border border-[#333537] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Clear Outputs</span>
                  </button>
                )}
              </div>

              {/* Ordered Blocks List */}
              {activeNotebook.blocks.length === 0 ? (
                <div className="rounded-xl bg-[#1E1F20] border border-[#333537] px-6 py-12 text-center space-y-4">
                  <p className="text-sm text-[#C4C7C5]">
                    This notebook has no blocks yet. Add a Python, SQL, C++, Java, LaTeX, or Markdown block to begin.
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleInsertBlock(0, 'code')}
                      className="h-9 px-4 rounded-lg bg-[#A8C7FA] text-[#131314] text-xs font-semibold hover:bg-[#C2D7FC] transition-colors"
                    >
                      + Code Block
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertBlock(0, 'text')}
                      className="h-9 px-4 rounded-lg bg-[#282A2C] text-[#E3E3E3] border border-[#333537] text-xs font-medium hover:bg-[#333537] transition-colors"
                    >
                      + Text Block
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <InsertDivider
                    onInsertCode={() => handleInsertBlock(0, 'code')}
                    onInsertText={() => handleInsertBlock(0, 'text')}
                  />

                  {activeNotebook.blocks.map((block, index) => (
                    <React.Fragment key={block.id}>
                      {block.type === 'code' ? (
                        <CodeBlock
                          block={block}
                          output={outputsByBlockId[block.id]}
                          isFirst={index === 0}
                          isLast={index === activeNotebook.blocks.length - 1}
                          autoFocus={block.id === newlyAddedBlockId}
                          onChangeContent={(content) => handleUpdateBlockContent(block.id, content)}
                          onChangeLanguage={(lang) => handleChangeBlockLanguage(block.id, lang)}
                          onChangeCppEngine={(engine) => handleChangeCppEngine(block.id, engine)}
                          onRun={() => void runBlock(block)}
                          onStop={handleStopOrRestartKernel}
                          onClearOutput={() =>
                            setOutputsByBlockId((prev) => {
                              const copy = { ...prev };
                              delete copy[block.id];
                              return copy;
                            })
                          }
                          onToggleCollapseOutput={() =>
                            setOutputsByBlockId((prev) => {
                              const curr = prev[block.id];
                              if (!curr) return prev;
                              return {
                                ...prev,
                                [block.id]: { ...curr, collapsed: !curr.collapsed },
                              };
                            })
                          }
                          onMoveUp={() => handleMoveBlock(index, -1)}
                          onMoveDown={() => handleMoveBlock(index, 1)}
                          onDelete={() => handleDeleteBlock(block.id)}
                        />
                      ) : (
                        <TextBlock
                          block={block}
                          isFirst={index === 0}
                          isLast={index === activeNotebook.blocks.length - 1}
                          autoEdit={block.id === newlyAddedBlockId}
                          onChange={(content) => handleUpdateBlockContent(block.id, content)}
                          onMoveUp={() => handleMoveBlock(index, -1)}
                          onMoveDown={() => handleMoveBlock(index, 1)}
                          onDelete={() => handleDeleteBlock(block.id)}
                        />
                      )}

                      <InsertDivider
                        onInsertCode={() => handleInsertBlock(index + 1, 'code')}
                        onInsertText={() => handleInsertBlock(index + 1, 'text')}
                        alwaysVisible={index === activeNotebook.blocks.length - 1}
                      />
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
              <FilePlus2 className="w-8 h-8 text-[#C4C7C5]/60" />
              <p className="text-sm text-[#C4C7C5]">Select or create a notebook to begin.</p>
              <button
                type="button"
                onClick={handleCreateNotebook}
                className="h-9 px-4 rounded-lg bg-[#A8C7FA] text-[#131314] text-xs font-semibold hover:bg-[#C2D7FC] transition-colors"
              >
                New Notebook
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Transient feedback toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg bg-[#282A2C] border border-[#333537] text-xs text-[#E3E3E3] shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
