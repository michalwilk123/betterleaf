"use client";

import { useMemo, useState } from "react";
import { Search, Target } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";

export interface EditorOptions {
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  autoCompile: boolean;
  fontSize: number;
}

export type Compiler = "pdflatex" | "xelatex" | "lualatex";

export interface CompileSettings {
  compiler: Compiler;
  haltOnError: boolean;
}

const STORAGE_KEY = "betterleaf-editor-options";

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;

const DEFAULT_OPTIONS: EditorOptions = {
  wordWrap: true,
  lineNumbers: true,
  minimap: false,
  autoCompile: false,
  fontSize: 14,
};

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OPTIONS.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

export function loadEditorOptions(): EditorOptions {
  if (typeof window === "undefined") return DEFAULT_OPTIONS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const merged = { ...DEFAULT_OPTIONS, ...JSON.parse(stored) };
      merged.fontSize = clampFontSize(merged.fontSize);
      return merged;
    }
  } catch {}
  return DEFAULT_OPTIONS;
}

interface PickerFile {
  _id: Id<"projectFiles">;
  name: string;
}

interface OptionsModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (options: EditorOptions) => void;
  compileSettings: CompileSettings;
  onApplyCompileSettings: (settings: CompileSettings) => void;
  files: PickerFile[];
  entrypointFileId: Id<"projectFiles"> | undefined;
  onSetEntrypoint: (fileId: Id<"projectFiles">) => void;
  isOwner: boolean;
}

export function OptionsModal({
  open,
  onClose,
  onApply,
  compileSettings,
  onApplyCompileSettings,
  files,
  entrypointFileId,
  onSetEntrypoint,
  isOwner,
}: OptionsModalProps) {
  const formKey = `${compileSettings.compiler}-${compileSettings.haltOnError}`;

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      {open ? (
        <OptionsModalForm
          key={formKey}
          onClose={onClose}
          onApply={onApply}
          compileSettings={compileSettings}
          onApplyCompileSettings={onApplyCompileSettings}
          files={files}
          entrypointFileId={entrypointFileId}
          onSetEntrypoint={onSetEntrypoint}
          isOwner={isOwner}
        />
      ) : null}
    </Modal>
  );
}

interface OptionsModalFormProps {
  onClose: () => void;
  onApply: (options: EditorOptions) => void;
  compileSettings: CompileSettings;
  onApplyCompileSettings: (settings: CompileSettings) => void;
  files: PickerFile[];
  entrypointFileId: Id<"projectFiles"> | undefined;
  onSetEntrypoint: (fileId: Id<"projectFiles">) => void;
  isOwner: boolean;
}

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function OptionsModalForm({
  onClose,
  onApply,
  compileSettings,
  onApplyCompileSettings,
  files,
  entrypointFileId,
  onSetEntrypoint,
  isOwner,
}: OptionsModalFormProps) {
  const [options, setOptions] = useState<EditorOptions>(() => loadEditorOptions());
  const [localCompile, setLocalCompile] = useState<CompileSettings>(compileSettings);
  const [entrypointQuery, setEntrypointQuery] = useState("");

  const toggle = (key: Exclude<keyof EditorOptions, "fontSize">) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFontSizeChange = (raw: string) => {
    if (raw === "") {
      setOptions((prev) => ({ ...prev, fontSize: DEFAULT_OPTIONS.fontSize }));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    setOptions((prev) => ({ ...prev, fontSize: clampFontSize(parsed) }));
  };

  const handleConfirm = () => {
    const normalized = { ...options, fontSize: clampFontSize(options.fontSize) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    onApply(normalized);

    if (
      localCompile.compiler !== compileSettings.compiler ||
      localCompile.haltOnError !== compileSettings.haltOnError
    ) {
      onApplyCompileSettings(localCompile);
    }

    onClose();
  };

  const editorItems: { key: Exclude<keyof EditorOptions, "fontSize">; label: string }[] = [
    { key: "wordWrap", label: "Word Wrap" },
    { key: "lineNumbers", label: "Line Numbers" },
    { key: "minimap", label: "Minimap" },
    { key: "autoCompile", label: "Auto-compile on Save" },
  ];

  const texMatches = useMemo(() => {
    const query = entrypointQuery.trim().toLowerCase();
    const tex = files.filter((f) => f.name.toLowerCase().endsWith(".tex"));
    const filtered = query
      ? tex.filter((f) => basename(f.name).toLowerCase().includes(query))
      : tex;
    return filtered
      .slice()
      .sort((a, b) => basename(a.name).localeCompare(basename(b.name)))
      .slice(0, 50);
  }, [files, entrypointQuery]);

  return (
    <div className="flex flex-col gap-5">
      {/* Editor section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Editor
        </h3>
        <div className="flex flex-col gap-1">
          {editorItems.map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-accent/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={options[item.key]}
                onChange={() => toggle(item.key)}
                className="h-4 w-4 rounded border-input text-primary accent-primary"
              />
              <span className="text-sm font-medium text-foreground">
                {item.label}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-3 rounded-md px-3 py-2">
            <span className="text-sm font-medium text-foreground flex-1">
              Font size
            </span>
            <input
              type="number"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={options.fontSize}
              onChange={(e) => handleFontSizeChange(e.target.value)}
              onBlur={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  fontSize: clampFontSize(Number.parseInt(e.target.value, 10)),
                }))
              }
              className="w-20 h-8 rounded-md border border-input bg-background px-2 text-sm text-right"
            />
          </label>
        </div>
      </div>

      {/* Project section: entrypoint picker */}
      {isOwner && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Project
          </h3>
          <div className="flex flex-col gap-2 px-3">
            <label className="text-sm font-medium text-foreground">
              Entrypoint
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={entrypointQuery}
                onChange={(e) => setEntrypointQuery(e.target.value)}
                placeholder="Search .tex files…"
                className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm"
              />
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background">
              {texMatches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No .tex files match.
                </div>
              ) : (
                texMatches.map((f) => {
                  const isCurrent = f._id === entrypointFileId;
                  const dir = dirname(f.name);
                  return (
                    <button
                      key={f._id}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => onSetEntrypoint(f._id)}
                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm transition-colors ${
                        isCurrent
                          ? "bg-primary/10 text-primary cursor-default"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="font-medium truncate">{basename(f.name)}</span>
                      {dir && (
                        <span className="text-xs text-muted-foreground truncate">
                          {dir}/
                        </span>
                      )}
                      {isCurrent && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs">
                          <Target className="h-3 w-3" />
                          Current
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compilation section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Compilation
        </h3>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3 rounded-md px-3 py-2">
            <span className="text-sm font-medium text-foreground min-w-[80px]">
              Compiler
            </span>
            <select
              value={localCompile.compiler}
              onChange={(e) =>
                setLocalCompile((prev) => ({
                  ...prev,
                  compiler: e.target.value as Compiler,
                }))
              }
              className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="pdflatex">pdflatex</option>
              <option value="xelatex">xelatex</option>
              <option value="lualatex">lualatex</option>
            </select>
          </label>
          <label className="flex items-center gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={localCompile.haltOnError}
              onChange={() =>
                setLocalCompile((prev) => ({
                  ...prev,
                  haltOnError: !prev.haltOnError,
                }))
              }
              className="h-4 w-4 rounded border-input text-primary accent-primary"
            />
            <span className="text-sm font-medium text-foreground">
              Halt on error
            </span>
          </label>
        </div>
      </div>

      <Button onClick={handleConfirm} className="w-full">
        Apply
      </Button>
    </div>
  );
}
