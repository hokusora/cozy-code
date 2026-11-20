import React, { useEffect, useState } from 'react';
import {
  Check,
  KeyRound,
  Link2,
  PanelLeft,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { SyncState } from '../types';

interface HeaderProps {
  workspaceKey: string;
  onChangeWorkspaceKey: (newKey: string) => void;
  onSyncNow: () => void;
  syncState: SyncState;
  lastSyncedAt: number | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  isRunningAny: boolean;
  onRunAll: () => void;
  onStopOrRestartKernel: () => void;
  hasActiveKernel: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  workspaceKey,
  onChangeWorkspaceKey,
  onSyncNow,
  syncState,
  lastSyncedAt,
  sidebarOpen,
  onToggleSidebar,
  isRunningAny,
  onRunAll,
  onStopOrRestartKernel,
  hasActiveKernel,
}) => {
  const [draftKey, setDraftKey] = useState(workspaceKey);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    setDraftKey(workspaceKey);
  }, [workspaceKey]);

  const normalizedDraft = draftKey.trim().toLowerCase();
  const isDirtyDraft = normalizedDraft.length > 0 && normalizedDraft !== workspaceKey;

  const commitWorkspaceKey = () => {
    if (normalizedDraft && normalizedDraft !== workspaceKey) {
      onChangeWorkspaceKey(normalizedDraft);
    } else {
      setDraftKey(workspaceKey);
    }
  };

  const handleCopyShareUrl = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('w', workspaceKey);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Fallback if clipboard blocked
    }
  };

  const syncLabel = (() => {
    if (syncState === 'syncing') return 'Syncing';
    if (syncState === 'offline') return 'Local only';
    if (syncState === 'error') return 'Retry sync';
    if (syncState === 'synced' && lastSyncedAt) return 'Synced';
    return 'Sync';
  })();

  return (
    <header className="h-14 shrink-0 bg-[#131314] border-b border-[#333537] px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 z-30">
      {/* Zone 1: Brand + Sidebar Toggle */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Hide notebook sidebar' : 'Show notebook sidebar'}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="h-9 w-9 flex items-center justify-center rounded-lg text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA]"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <span className="hidden sm:inline font-display text-[15px] font-semibold tracking-tight text-[#E3E3E3] whitespace-nowrap shrink-0">
          Canvas Notebook
        </span>
      </div>

      {/* Zone 2: Cross-Device Workspace Key Switcher + Manual Sync */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-md w-full justify-center">
        <div className="flex items-center gap-1.5 bg-[#1E1F20] border border-[#333537] focus-within:border-[#A8C7FA] rounded-lg px-2.5 h-9 w-full max-w-[270px] transition-colors">
          <KeyRound className="w-3.5 h-3.5 text-[#C4C7C5] shrink-0" />
          <input
            type="text"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onBlur={commitWorkspaceKey}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraftKey(workspaceKey);
                e.currentTarget.blur();
              }
            }}
            aria-label="Workspace Key for cross-device sync"
            placeholder="workspace-key"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="bg-transparent text-xs font-mono-code text-[#E3E3E3] placeholder-[#8E918F] w-full focus:outline-none truncate"
          />
          {isDirtyDraft ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commitWorkspaceKey();
              }}
              title="Apply workspace key"
              aria-label="Apply workspace key"
              className="text-[#131314] bg-[#A8C7FA] hover:bg-[#C2D7FC] rounded px-1.5 py-0.5 text-[11px] font-semibold shrink-0"
            >
              Go
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCopyShareUrl}
              title="Copy cross-device workspace link"
              aria-label="Copy cross-device workspace link"
              className="text-[#C4C7C5] hover:text-[#A8C7FA] transition-colors shrink-0 p-1 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#A8C7FA]"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-[#81C995]" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onSyncNow}
          disabled={syncState === 'syncing'}
          title="Sync workspace with cloud now"
          aria-label="Sync workspace with cloud now"
          className={`h-9 px-2.5 rounded-lg border text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA] ${
            syncState === 'error'
              ? 'bg-[#3C1E1E] border-[#F28B82]/50 text-[#F28B82]'
              : 'bg-[#1E1F20] border-[#333537] text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C]'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncState === 'syncing' ? 'animate-spin text-[#A8C7FA]' : ''}`} />
          <span className="hidden lg:inline">{syncLabel}</span>
        </button>
      </div>

      {/* Zone 3: Execution Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onStopOrRestartKernel}
          title={isRunningAny ? 'Stop execution and terminate worker' : 'Restart kernel and reclaim memory'}
          className={`h-9 px-2.5 sm:px-3 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA] ${
            isRunningAny
              ? 'bg-[#3C1E1E] border-[#F28B82]/50 text-[#F28B82] hover:bg-[#4B2424]'
              : hasActiveKernel
                ? 'bg-[#1E1F20] border-[#333537] text-[#E3E3E3] hover:bg-[#282A2C]'
                : 'bg-[#1E1F20] border-[#333537] text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C]'
          }`}
        >
          {isRunningAny ? (
            <>
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop</span>
            </>
          ) : (
            <>
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Restart Kernel</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onRunAll}
          disabled={isRunningAny}
          className="h-9 px-3 sm:px-4 rounded-lg text-xs font-semibold bg-[#A8C7FA] text-[#131314] hover:bg-[#C2D7FC] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314] focus-visible:ring-[#A8C7FA]"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Run All</span>
        </button>
      </div>
    </header>
  );
};
