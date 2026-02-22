"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface CreateFileModalProps {
  open: boolean;
  onClose: () => void;
  mode: "file" | "directory";
  onCreate: (name: string) => Promise<void>;
}

export function CreateFileModal({ open, onClose, mode, onCreate }: CreateFileModalProps) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const placeholder = mode === "file" ? "untitled.tex" : "new-folder";
  const title = mode === "file" ? "New File" : "New Directory";

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await onCreate(trimmed);
      handleClose();
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (creating) return;
    onClose();
    setName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) handleConfirm();
  };

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            {mode === "file" ? "File Name" : "Directory Name"}
          </label>
          <Input
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={creating}
            autoFocus
          />
        </div>
        <Button
          onClick={handleConfirm}
          disabled={creating || !name.trim()}
          className="w-full gap-2"
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          {creating ? "Creating..." : `Create ${mode === "file" ? "File" : "Directory"}`}
        </Button>
      </div>
    </Modal>
  );
}
