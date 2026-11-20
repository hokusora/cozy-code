import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ArrowDown, ArrowUp, Check, Pencil, Trash2 } from 'lucide-react';
import type { NotebookBlock } from '../types';

interface TextBlockProps {
  block: NotebookBlock;
  isFirst: boolean;
  isLast: boolean;
  autoEdit?: boolean;
  onChange: (content: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

export const TextBlock: React.FC<TextBlockProps> = ({
  block,
  isFirst,
  isLast,
  autoEdit = false,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(autoEdit || !block.content.trim());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(84, textareaRef.current.scrollHeight)}px`;
    }
  }, [isEditing, block.content]);

  return (
    <section
      className={`group relative rounded-xl border transition-colors ${
        isEditing
          ? 'bg-[#1E1F20] border-[#A8C7FA]/60'
          : 'bg-transparent border-transparent hover:bg-[#1E1F20]/70 hover:border-[#333537]'
      }`}
    >
      {/* Top-right floating block toolbar */}
      <div
        className={`absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 bg-[#282A2C] border border-[#333537] rounded-lg p-0.5 transition-opacity ${
          isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => setIsEditing((prev) => !prev)}
          title={isEditing ? 'Render Markdown (Shift+Enter)' : 'Edit Markdown (Double-click)'}
          aria-label={isEditing ? 'Render Markdown' : 'Edit Markdown'}
          className="h-7 px-2 rounded-md text-xs text-[#E3E3E3] hover:bg-[#333537] flex items-center gap-1 transition-colors"
        >
          {isEditing ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#A8C7FA]" />
              <span>Done</span>
            </>
          ) : (
            <Pencil className="w-3.5 h-3.5 text-[#C4C7C5]" />
          )}
        </button>

        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move block up"
          aria-label="Move block up"
          className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#333537] disabled:opacity-35 disabled:pointer-events-none transition-colors"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move block down"
          aria-label="Move block down"
          className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#333537] disabled:opacity-35 disabled:pointer-events-none transition-colors"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onDelete}
          title="Delete text block"
          aria-label="Delete text block"
          className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#F28B82] hover:bg-[#333537] transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isEditing ? (
        <div className="p-4 pr-36">
          <textarea
            ref={textareaRef}
            value={block.content}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              if (block.content.trim()) {
                setIsEditing(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                setIsEditing(false);
              }
            }}
            placeholder="Write Markdown notes or KaTeX math ($E = mc^2$ or $$ \int_0^1 x^2 dx $$)..."
            className="w-full bg-transparent text-sm font-mono-code text-[#E3E3E3] placeholder-[#8E918F] resize-none focus:outline-none leading-relaxed"
          />
          <div className="mt-2 text-[11px] text-[#C4C7C5]/70">
            Supports Markdown, GFM tables, inline $LaTeX$, and display $$LaTeX$$ · Press Shift+Enter to render
          </div>
        </div>
      ) : (
        <div
          onDoubleClick={() => setIsEditing(true)}
          className="px-5 py-4 cursor-text min-h-[52px]"
          title="Double-click to edit Markdown"
        >
          {block.content.trim() ? (
            <div className="notebook-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {block.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-[#8E918F] italic">
              Double-click to write Markdown or $LaTeX$ notes...
            </p>
          )}
        </div>
      )}
    </section>
  );
};
