"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface EditorOptions {
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  autoCompile: boolean;
}

export type Compiler = "pdflatex" | "xelatex" | "lualatex";

export interface CompileSettings {
  compiler: Compiler;
  haltOnError: boolean;
}

const STORAGE_KEY = "betterleaf-editor-options";

const DEFAULT_OPTIONS: EditorOptions = {
  wordWrap: true,
  lineNumbers: true,
  minimap: false,
  autoCompile: false,
};

export function loadEditorOptions(): EditorOptions {
  if (typeof window === "undefined") return DEFAULT_OPTIONS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_OPTIONS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_OPTIONS;
}

interface OptionsModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (options: EditorOptions) => void;
  compileSettings: CompileSettings;
  onApplyCompileSettings: (settings: CompileSettings) => void;
}

export function OptionsModal({
  open,
  onClose,
  onApply,
  compileSettings,
  onApplyCompileSettings,
}: OptionsModalProps) {
  const [options, setOptions] = useState<EditorOptions>(DEFAULT_OPTIONS);
  const [localCompile, setLocalCompile] = useState<CompileSettings>(compileSettings);

  useEffect(() => {
    if (open) {
      setOptions(loadEditorOptions());
      setLocalCompile(compileSettings);
    }
  }, [open, compileSettings]);

  const toggle = (key: keyof EditorOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirm = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    onApply(options);

    if (
      localCompile.compiler !== compileSettings.compiler ||
      localCompile.haltOnError !== compileSettings.haltOnError
    ) {
      onApplyCompileSettings(localCompile);
    }

    onClose();
  };

  const editorItems: { key: keyof EditorOptions; label: string }[] = [
    { key: "wordWrap", label: "Word Wrap" },
    { key: "lineNumbers", label: "Line Numbers" },
    { key: "minimap", label: "Minimap" },
    { key: "autoCompile", label: "Auto-compile on Save" },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Settings">
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
          </div>
        </div>

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
    </Modal>
  );
}
