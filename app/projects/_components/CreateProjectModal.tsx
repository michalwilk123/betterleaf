"use client";

import { useState, useRef, useCallback, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Folder, FolderOpen, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { uploadFilesParallel } from "@/lib/uploadUtils";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

interface UploadItem {
  file: File;
  path: string;
}

interface TreeNode {
  name: string;
  path: string;
  files: UploadItem[];
  children: Map<string, TreeNode>;
}

function createTreeNode(name: string, path: string): TreeNode {
  return {
    name,
    path,
    files: [],
    children: new Map(),
  };
}

function buildFileTree(items: UploadItem[]): TreeNode {
  const root = createTreeNode("", "");

  for (const item of items) {
    const normalizedPath = item.path.replaceAll("\\", "/");
    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let node = root;
    let currentPath = "";

    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = node.children.get(segment);
      if (existing) {
        node = existing;
        continue;
      }
      const next = createTreeNode(segment, currentPath);
      node.children.set(segment, next);
      node = next;
    }

    node.files.push(item);
  }

  return root;
}

function renderTreeNode(
  node: TreeNode,
  depth: number,
  onRemove: (path: string) => void
): ReactElement[] {
  const elements: ReactElement[] = [];
  const indentStyle = { paddingLeft: `${depth * 12}px` };
  const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const sortedFiles = [...node.files].sort((a, b) => a.path.localeCompare(b.path));

  for (const child of sortedChildren) {
    elements.push(
      <div
        key={`folder-${child.path}`}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-foreground"
        style={indentStyle}
      >
        {depth === 0 ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{child.name}</span>
      </div>
    );

    elements.push(...renderTreeNode(child, depth + 1, onRemove));
  }

  for (const item of sortedFiles) {
    const fileName = item.path.split("/").pop() ?? item.path;
    elements.push(
      <div
        key={`file-${item.path}`}
        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-foreground hover:bg-accent/50"
        style={indentStyle}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{fileName}</span>
        <button
          onClick={() => onRemove(item.path)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${item.path}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return elements;
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createProject = useMutation(api.projects.create);
  const generateFileUploadUrl = useMutation(api.files.generateUploadUrl);
  const createManyText = useMutation(api.files.createManyText);
  const createManyBinary = useMutation(api.files.createManyBinary);

  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: UploadItem[] = [];

    for (const file of Array.from(fileList)) {
      if (/\.zip$/i.test(file.name)) {
        const zipBaseName = file.name.replace(/\.zip$/i, "").trim();
        if (zipBaseName) {
          setName((prev) => (prev.trim().length > 0 ? prev : zipBaseName));
        }
        const zip = await JSZip.loadAsync(file);
        const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);

        for (const [path, entry] of entries) {
          const blob = await entry.async("blob");
          if (!path) continue;
          newFiles.push({
            file: new File([blob], path.split("/").pop() ?? "file"),
            path,
          });
        }
      } else {
        const relativePath = file.webkitRelativePath
          ? file.webkitRelativePath
          : file.name;
        newFiles.push({ file, path: relativePath });
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleConfirm = async () => {
    setCreating(true);
    try {
      const result = await createProject({
        name: name.trim() || undefined,
        skipDefaultFile: files.length > 0 ? true : undefined,
      });

      // Upload files in parallel
      if (files.length > 0) {
        setUploadProgress({ processed: 0, total: files.length });
        const uploadResult = await uploadFilesParallel(
          files.map((f) => f.file),
          {
            generateUploadUrl: () => generateFileUploadUrl({}),
            createManyText: (args) => createManyText(args as Parameters<typeof createManyText>[0]),
            createManyBinary: (args) => createManyBinary(args as Parameters<typeof createManyBinary>[0]),
            projectId: result.projectId,
            resolveName: (file) => {
              const item = files.find((f) => f.file === file);
              return item?.path ?? file.name;
            },
            onProgress: (processed, total) => setUploadProgress({ processed, total }),
          }
        );
        setUploadProgress(null);

        if (uploadResult.failed.length > 0) {
          toast.warning(
            `Uploaded ${uploadResult.succeeded}, failed ${uploadResult.failed.length}`,
            { description: uploadResult.failed.map((f) => f.name).join(", ") }
          );
        }
      }

      onClose();
      setName("");
      setFiles([]);
      router.push(`/projects/${result.shortId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const removeFile = (path: string) => {
    setFiles((prev) => {
      const index = prev.findIndex((item) => item.path === path);
      if (index === -1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleClose = () => {
    if (creating) return;
    onClose();
    setName("");
    setFiles([]);
  };

  return (
    <Modal open={open} onClose={handleClose} title="New Project">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            Project Name
          </label>
          <Input
            placeholder="Untitled Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
            autoFocus
          />
        </div>

        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            Upload Files
          </label>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={creating}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              handleUpload(e.target.files);
              e.target.value = "";
            }}
            className="hidden"
          />
        </div>

        {files.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2">
            <div className="flex flex-col gap-1">
              {renderTreeNode(buildFileTree(files), 0, removeFile)}
            </div>
          </div>
        )}

        {uploadProgress && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Uploading {uploadProgress.processed}/{uploadProgress.total} files...
            </span>
            <div className="h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.processed / uploadProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <Button
          onClick={handleConfirm}
          disabled={creating}
          className="w-full gap-2"
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          {creating
            ? uploadProgress
              ? "Uploading files..."
              : "Creating..."
            : "Create Project"}
        </Button>
      </div>
    </Modal>
  );
}
