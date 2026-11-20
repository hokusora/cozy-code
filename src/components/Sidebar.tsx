import React, { useMemo, useState } from 'react';
import { Check, FileCode2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { NotebookRecord } from '../types';

interface SidebarProps {
  open: boolean;
  notebooks: NotebookRecord[];
  activeNotebookId: string;
  onSelectNotebook: (id: string) => void;
  onCreateNotebook: () => void;
  onRenameNotebook: (id: string, newTitle: string) => void;
  onDeleteNotebook: (id: string) => void;
  onCloseMobile: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export const Sidebar: React.FC<SidebarProps> = ({
  open,
  notebooks,
  activeNotebookId,
  onSelectNotebook,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onCloseMobile,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visibleNotebooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notebooks
      .filter((nb) => !nb.is_deleted)
      .filter((nb) => !q || nb.title.toLowerCase().includes(q));
  }, [notebooks, searchQuery]);

  if (!open) return null;

  const startRename = (nb: NotebookRecord) => {
    setConfirmDeleteId(null);
    setEditingId(nb.id);
    setEditDraft(nb.title);
  };

  const commitRename = (id: string) => {
    const trimmed = editDraft.trim();
    if (trimmed) {
      onRenameNotebook(id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-30 md:hidden"
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside className="fixed md:static inset-y-0 left-0 top-14 md:top-0 w-[264px] shrink-0 bg-[#1E1F20] border-r border-[#333537] flex flex-col z-40">
        {/* Top actions */}
        <div className="p-3.5 space-y-2.5 border-b border-[#333537]">
          <button
            type="button"
            onClick={() => {
              onCreateNotebook();
              onCloseMobile();
            }}
            className="w-full h-9 px-3 rounded-lg bg-[#282A2C] hover:bg-[#333537] text-[#E3E3E3] text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA]"
          >
            <Plus className="w-4 h-4 text-[#A8C7FA]" />
            <span>New Notebook</span>
          </button>

          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#C4C7C5]/70 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter notebooks..."
              aria-label="Filter notebooks"
              className="w-full h-8 pl-8 pr-2.5 bg-[#131314] border border-[#333537] focus:border-[#A8C7FA] rounded-md text-xs text-[#E3E3E3] placeholder-[#8E918F] focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Notebook list */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1" aria-label="Workspace notebooks">
          {visibleNotebooks.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[#C4C7C5]/70">
              No matching notebooks.
            </div>
          ) : (
            visibleNotebooks.map((nb) => {
              const isActive = nb.id === activeNotebookId;
              const isEditing = editingId === nb.id;
              const isConfirmingDelete = confirmDeleteId === nb.id;

              return (
                <div
                  key={nb.id}
                  className={`group rounded-lg transition-colors ${
                    isActive
                      ? 'bg-[#282A2C] text-[#E3E3E3]'
                      : 'text-[#C4C7C5] hover:bg-[#282A2C]/60 hover:text-[#E3E3E3]'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1 p-2">
                      <input
                        type="text"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(nb.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="flex-1 min-w-0 bg-[#131314] border border-[#A8C7FA] rounded px-2 py-1 text-xs text-[#E3E3E3] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitRename(nb.id)}
                        aria-label="Save title"
                        className="p-1 text-[#A8C7FA] hover:bg-[#333537] rounded"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel rename"
                        className="p-1 text-[#C4C7C5] hover:bg-[#333537] rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : isConfirmingDelete ? (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
                      <span className="text-[#F28B82] truncate">Delete notebook?</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            onDeleteNotebook(nb.id);
                          }}
                          className="px-2 py-1 rounded bg-[#3C1E1E] text-[#F28B82] hover:bg-[#4B2424] font-medium"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded bg-[#333537] text-[#E3E3E3] hover:bg-[#44474A]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        onSelectNotebook(nb.id);
                        onCloseMobile();
                      }}
                      onDoubleClick={() => startRename(nb)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectNotebook(nb.id);
                          onCloseMobile();
                        }
                      }}
                      className="flex items-start justify-between gap-2 px-2.5 py-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA] rounded-lg"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <FileCode2
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            isActive ? 'text-[#A8C7FA]' : 'text-[#C4C7C5]/70'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-[13px] font-medium truncate ${
                              isActive ? 'text-[#A8C7FA]' : 'text-[#E3E3E3]'
                            }`}
                          >
                            {nb.title}
                          </div>
                          <div className="text-[11px] text-[#C4C7C5]/70 font-mono-code mt-0.5 flex items-center gap-1.5">
                            <span>{nb.blocks.length} {nb.blocks.length === 1 ? 'block' : 'blocks'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatRelativeTime(nb.updated_at)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(nb);
                          }}
                          aria-label={`Rename ${nb.title}`}
                          title="Rename"
                          className="p-1 rounded text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#333537]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(nb.id);
                          }}
                          aria-label={`Delete ${nb.title}`}
                          title="Delete"
                          className="p-1 rounded text-[#C4C7C5] hover:text-[#F28B82] hover:bg-[#333537]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* Quiet persistence note */}
        <div className="px-4 py-3 border-t border-[#333537] text-[11px] leading-relaxed text-[#C4C7C5]/75">
          Blocks persist across refreshes. Outputs stay in RAM and clear on reload.
        </div>
      </aside>
    </>
  );
};
