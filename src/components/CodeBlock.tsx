import React, { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { markdown } from '@codemirror/lang-markdown';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eraser,
  Loader2,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import type { BlockExecutionOutput, CodeLanguage, CppEngine, NotebookBlock } from '../types';

interface CodeBlockProps {
  block: NotebookBlock;
  output?: BlockExecutionOutput;
  isFirst: boolean;
  isLast: boolean;
  autoFocus?: boolean;
  onChangeContent: (content: string) => void;
  onChangeLanguage: (language: CodeLanguage) => void;
  onChangeCppEngine: (engine: CppEngine) => void;
  onRun: () => void;
  onStop: () => void;
  onClearOutput: () => void;
  onToggleCollapseOutput: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

const LANGUAGES: Array<{ value: CodeLanguage; label: string; placeholder: string }> = [
  {
    value: 'python',
    label: 'Python',
    placeholder: '# Write Python code (Pyodide Wasm). Press Shift+Enter to run...',
  },
  {
    value: 'sql',
    label: 'SQL',
    placeholder: '-- Write SQL queries (DuckDB-Wasm :memory:). Press Shift+Enter to run...',
  },
  {
    value: 'cpp',
    label: 'C++',
    placeholder: '// Write C++ code (JSCPP browser or GCC C++20 cloud). Press Shift+Enter to run...',
  },
  {
    value: 'java',
    label: 'Java',
    placeholder: '// Write Java code (public class Main). Press Shift+Enter to run...',
  },
  {
    value: 'latex',
    label: 'LaTeX',
    placeholder: '% Enter LaTeX math expression (KaTeX display mode), e.g. \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  },
];

export const CodeBlock: React.FC<CodeBlockProps> = ({
  block,
  output,
  isFirst,
  isLast,
  autoFocus = false,
  onChangeContent,
  onChangeLanguage,
  onChangeCppEngine,
  onRun,
  onStop,
  onClearOutput,
  onToggleCollapseOutput,
  onMoveUp,
  onMoveDown,
  onDelete,
}) => {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const isRunning = output?.status === 'running' || output?.status === 'loading-runtime';

  const extensions = useMemo(() => {
    const langExt = (() => {
      switch (block.language) {
        case 'python':
          return python();
        case 'sql':
          return sql();
        case 'cpp':
          return cpp();
        case 'java':
          return java();
        case 'latex':
          return markdown();
      }
    })();

    const shiftEnterExt = Prec.highest(
      keymap.of([
        {
          key: 'Shift-Enter',
          run: () => {
            onRunRef.current();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ])
    );

    return [langExt, shiftEnterExt];
  }, [block.language]);

  const langMeta = LANGUAGES.find((l) => l.value === block.language) || LANGUAGES[0];
  const cppEngine: CppEngine = block.engine || 'jscpp';

  const hasOutputBody =
    Boolean(output) &&
    (output!.status === 'loading-runtime' ||
      output!.status === 'running' ||
      Boolean(output!.stdout) ||
      Boolean(output!.stderr) ||
      Boolean(output!.latexHtml) ||
      (output!.images && output!.images.length > 0) ||
      (output!.tables && output!.tables.length > 0));

  const execBadge = isRunning
    ? '[*]'
    : output?.executionCount != null
      ? `[${output.executionCount}]`
      : '[ ]';

  return (
    <section
      className={`group rounded-xl bg-[#1E1F20] border border-[#333537] transition-colors ${
        isRunning ? 'gemini-running-ring' : 'focus-within:border-[#A8C7FA]/50'
      }`}
    >
      {/* Top micro-toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#333537]/80 bg-[#1E1F20] rounded-t-xl">
        <div className="flex items-center gap-3 min-w-0">
          <select
            value={block.language}
            onChange={(e) => onChangeLanguage(e.target.value as CodeLanguage)}
            aria-label="Block language"
            className="bg-[#282A2C] hover:bg-[#333537] text-xs font-medium text-[#E3E3E3] rounded-md px-2.5 py-1 border border-[#333537] focus:outline-none focus:border-[#A8C7FA] cursor-pointer transition-colors"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value} className="bg-[#1E1F20] text-[#E3E3E3]">
                {lang.label}
              </option>
            ))}
          </select>

          {block.language === 'cpp' && (
            <div
              className="flex items-center gap-0.5 p-0.5 bg-[#131314] border border-[#333537] rounded-md"
              role="group"
              aria-label="C++ execution engine"
            >
              <button
                type="button"
                onClick={() => onChangeCppEngine('jscpp')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  cppEngine === 'jscpp'
                    ? 'bg-[#282A2C] text-[#A8C7FA]'
                    : 'text-[#C4C7C5] hover:text-[#E3E3E3]'
                }`}
              >
                JSCPP
              </button>
              <button
                type="button"
                onClick={() => onChangeCppEngine('cloud')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  cppEngine === 'cloud'
                    ? 'bg-[#282A2C] text-[#A8C7FA]'
                    : 'text-[#C4C7C5] hover:text-[#E3E3E3]'
                }`}
              >
                GCC C++20
              </button>
            </div>
          )}

          {output && output.durationMs !== null && !isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#C4C7C5]/80 font-mono-code truncate">
              <span>{output.durationMs}ms</span>
              {output.provider && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{output.provider}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {hasOutputBody && !isRunning && (
            <button
              type="button"
              onClick={onClearOutput}
              title="Clear cell output"
              aria-label="Clear cell output"
              className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C] transition-colors"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            title="Move block up"
            aria-label="Move block up"
            className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            title="Move block down"
            aria-label="Move block down"
            className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#E3E3E3] hover:bg-[#282A2C] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onDelete}
            title="Delete code block"
            aria-label="Delete code block"
            className="h-7 w-7 flex items-center justify-center rounded-md text-[#C4C7C5] hover:text-[#F28B82] hover:bg-[#282A2C] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main gutter + CodeMirror 6 body */}
      <div className="flex items-stretch">
        {/* Left execution gutter */}
        <div className="w-[54px] shrink-0 border-r border-[#333537]/60 bg-[#1B1C1D] flex flex-col items-center pt-2.5 pb-2 gap-1.5 select-none rounded-bl-xl">
          <button
            type="button"
            onClick={isRunning ? onStop : onRun}
            title={isRunning ? 'Stop execution' : 'Run cell (Shift+Enter)'}
            aria-label={isRunning ? 'Stop execution' : 'Run cell'}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA] ${
              isRunning
                ? 'bg-[#3C1E1E] text-[#F28B82] hover:bg-[#4B2424]'
                : 'bg-[#282A2C] text-[#A8C7FA] hover:bg-[#333537]'
            }`}
          >
            {isRunning ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <span className="text-[11px] font-mono-code text-[#C4C7C5]/70">{execBadge}</span>
        </div>

        {/* CodeMirror 6 VS Code Dark Modern editor */}
        <div className="flex-1 min-w-0 canvas-cm-wrapper">
          <CodeMirror
            value={block.content}
            theme={vscodeDark}
            extensions={extensions}
            autoFocus={autoFocus}
            placeholder={langMeta.placeholder}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: false,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
              indentOnInput: true,
              tabSize: 4,
            }}
            onChange={onChangeContent}
          />
        </div>
      </div>

      {/* Collapsible Ephemeral Output Drawer (RAM-only) */}
      {hasOutputBody && output && (
        <div className="border-t border-[#333537] bg-[#161718] rounded-b-xl">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#333537]/60">
            <button
              type="button"
              onClick={onToggleCollapseOutput}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[#C4C7C5] hover:text-[#E3E3E3] transition-colors"
            >
              {output.collapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}

              {isRunning ? (
                <span className="flex items-center gap-1.5 text-[#A8C7FA]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{output.runtimeMessage || 'Running...'}</span>
                </span>
              ) : output.status === 'error' ? (
                <span className="flex items-center gap-1.5 text-[#F28B82]">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Error</span>
                </span>
              ) : (
                <span>Output</span>
              )}
            </button>

            <span className="text-[11px] text-[#8E918F]">Ephemeral · RAM only</span>
          </div>

          {!output.collapsed && (
            <div className="px-4 py-3 space-y-3 overflow-x-auto">
              {/* stdout */}
              {output.stdout && (
                <pre className="text-[13px] font-mono-code text-[#E3E3E3] whitespace-pre-wrap break-words leading-relaxed">
                  {output.stdout}
                </pre>
              )}

              {/* KaTeX standalone math output */}
              {output.latexHtml && (
                <div
                  className="py-2 text-[#E3E3E3] overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: output.latexHtml }}
                />
              )}

              {/* Rendered tables (SQL / Pandas DataFrames) */}
              {output.tables &&
                output.tables.map((table, tIdx) => (
                  <div key={tIdx} className="space-y-1.5">
                    <div className="overflow-x-auto border border-[#333537] rounded-lg">
                      <table className="w-full text-left border-collapse text-xs font-mono-code">
                        <thead>
                          <tr className="bg-[#1E1F20] border-b border-[#333537] text-[#C4C7C5]">
                            {table.columns.map((col, cIdx) => (
                              <th
                                key={cIdx}
                                className="px-3 py-2 font-semibold whitespace-nowrap border-r last:border-r-0 border-[#333537]/60"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#333537]/50">
                          {table.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="hover:bg-[#282A2C]/50 transition-colors"
                            >
                              {row.map((cell, cIdx) => {
                                const isNumeric = typeof cell === 'number';
                                return (
                                  <td
                                    key={cIdx}
                                    className={`px-3 py-1.5 whitespace-nowrap border-r last:border-r-0 border-[#333537]/40 ${
                                      isNumeric ? 'text-right text-[#A8C7FA]' : 'text-[#E3E3E3]'
                                    }`}
                                  >
                                    {cell === null ? (
                                      <span className="text-[#8E918F] italic">null</span>
                                    ) : (
                                      String(cell)
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[11px] font-mono-code text-[#C4C7C5]/75">
                      {table.rowCount.toLocaleString()} {table.rowCount === 1 ? 'row' : 'rows'}
                      {table.truncated ? ` (showing first ${table.rows.length})` : ''}
                    </div>
                  </div>
                ))}

              {/* Rendered plots / Matplotlib PNG images */}
              {output.images && output.images.length > 0 && (
                <div className="flex flex-col gap-3">
                  {output.images.map((src, iIdx) => (
                    <img
                      key={iIdx}
                      src={src}
                      alt={`Execution plot ${iIdx + 1}`}
                      className="max-w-full h-auto rounded-lg border border-[#333537] bg-[#1E1F20]"
                    />
                  ))}
                </div>
              )}

              {/* stderr */}
              {output.stderr && (
                <pre className="text-[12.5px] font-mono-code text-[#F28B82] bg-[#2B1919]/60 border border-[#F28B82]/30 rounded-lg p-3 whitespace-pre-wrap break-words leading-relaxed">
                  {output.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
