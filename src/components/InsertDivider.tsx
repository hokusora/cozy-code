import React from 'react';
import { Code2, Type } from 'lucide-react';

interface InsertDividerProps {
  onInsertCode: () => void;
  onInsertText: () => void;
  alwaysVisible?: boolean;
}

export const InsertDivider: React.FC<InsertDividerProps> = ({
  onInsertCode,
  onInsertText,
  alwaysVisible = false,
}) => {
  return (
    <div
      className={`group relative flex items-center justify-center ${
        alwaysVisible ? 'py-4' : 'h-7 my-0.5'
      }`}
    >
      <div
        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-px transition-opacity duration-150 ${
          alwaysVisible
            ? 'bg-[#333537]/60 opacity-100'
            : 'bg-[#333537] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      />

      <div
        className={`relative z-10 flex items-center gap-2 transition-opacity duration-150 ${
          alwaysVisible
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={onInsertCode}
          className="h-7 px-3 rounded-md bg-[#1E1F20] hover:bg-[#282A2C] border border-[#333537] hover:border-[#A8C7FA]/60 text-xs font-medium text-[#E3E3E3] flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA]"
        >
          <Code2 className="w-3.5 h-3.5 text-[#A8C7FA]" />
          <span>+ Code</span>
        </button>

        <button
          type="button"
          onClick={onInsertText}
          className="h-7 px-3 rounded-md bg-[#1E1F20] hover:bg-[#282A2C] border border-[#333537] hover:border-[#A8C7FA]/60 text-xs font-medium text-[#E3E3E3] flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA]"
        >
          <Type className="w-3.5 h-3.5 text-[#C4C7C5]" />
          <span>+ Text</span>
        </button>
      </div>
    </div>
  );
};
