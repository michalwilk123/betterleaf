"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FileText, Search } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { searchFiles } from "@/lib/fuzzyFileSearch";

interface QuickOpenFile {
  _id: Id<"projectFiles">;
  name: string;
}

interface QuickOpenProps {
  files: QuickOpenFile[];
  onSelect: (fileId: Id<"projectFiles">) => void;
  onClose: () => void;
}

export function QuickOpen({ files, onSelect, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchFiles(files, query), [files, query]);
  const activeIndex = Math.min(selectedIndex, Math.max(results.length - 1, 0));

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-result-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  const selectFile = (file: QuickOpenFile) => {
    onSelect(file._id);
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      setSelectedIndex(
        (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const file = results[activeIndex];
      if (file) selectFile(file);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Quick open file"
      className="absolute left-1/2 top-14 z-40 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-white shadow-xl"
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name or path..."
          aria-label="Search project files"
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={results.length ? `quick-open-option-${activeIndex}` : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
      </div>

      <div ref={listRef} id="quick-open-results" role="listbox" className="max-h-72 overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {files.length === 0 ? "No files to open" : "No matching files"}
          </p>
        ) : (
          results.map((file, index) => {
            const slash = file.name.lastIndexOf("/");
            return (
              <button
                key={file._id}
                id={`quick-open-option-${index}`}
                data-result-index={index}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => selectFile(file)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/50"
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{file.name.slice(slash + 1)}</span>
                {slash !== -1 && (
                  <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                    {file.name.slice(0, slash)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        ↑↓ Navigate · Enter Open · Esc Close
      </div>
    </div>
  );
}
