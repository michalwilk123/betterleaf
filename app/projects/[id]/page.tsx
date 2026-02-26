"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import {
  ArrowLeft,
  Leaf,
  Folder,
  FolderOpen,
  Settings,
  Share2,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  FilePlus,
  FolderPlus,
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Target,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateFileModal } from "./_components/CreateFileModal";
import { ShareModal } from "./_components/ShareModal";
import { OptionsModal, loadEditorOptions, type EditorOptions, type CompileSettings } from "./_components/OptionsModal";
import { toast } from "sonner";
import { uploadFilesParallel } from "@/lib/uploadUtils";

const Editor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading editor...
      </div>
    ),
  }
);

const PdfViewer = dynamic(() => import("../../components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Loading PDF viewer...
    </div>
  ),
});

// --- Helpers ---

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  css: "css",
  html: "html",
  json: "json",
  md: "markdown",
  py: "python",
  tex: "latex",
  bib: "bibtex",
};

const BINARY_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "pdf", "bmp", "eps", "svg", "zip",
]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "svg"]);

function isBinaryFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

function isImageFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function langFromFilename(name: string) {
  const ext = name.split(".").pop() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

async function computeContentHash(
  files: Array<{ _id: string; name: string; content: string; storageUrl?: string | null }>,
  activeFileId: string | null,
  currentContent: string
): Promise<string> {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const hashInput: Array<[string, string]> = [];

  for (const file of sortedFiles) {
    if (file.storageUrl) {
      hashInput.push([file.name, file.storageUrl]);
    } else {
      const fileContent = file._id === activeFileId ? currentContent : file.content;
      hashInput.push([file.name, fileContent]);
    }
  }

  const canonical = JSON.stringify(hashInput);
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Component ---
export default function EditorPage() {
  const params = useParams();
  const shortId = params.id as string;
  const convex = useConvex();

  const project = useQuery(api.projects.get, { shortId });
  const files = useQuery(
    api.files.listByProject,
    project ? { projectId: project._id } : "skip"
  );

  const updateProject = useMutation(api.projects.update);
  const createFile = useMutation(api.files.create);
  const updateFileContent = useMutation(api.files.updateContent);
  const renameFileMut = useMutation(api.files.rename);
  const removeFile = useMutation(api.files.remove);
  const setEntrypoint = useMutation(api.projects.setEntrypoint);
  const generateCompilationUploadUrl = useMutation(api.compilations.generateUploadUrl);
  const saveCompilation = useMutation(api.compilations.save);
  const generateFileUploadUrl = useMutation(api.files.generateUploadUrl);
  const createManyText = useMutation(api.files.createManyText);
  const createManyBinary = useMutation(api.files.createManyBinary);

  // Project name (editable)
  const [projectName, setProjectName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Active file
  const [activeFileId, setActiveFileId] = useState<Id<"projectFiles"> | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | undefined>(undefined);
  const [fromCache, setFromCache] = useState(false);
  const lastCompileRef = useRef<{ hash: string; pdfUrl: string } | null>(null);

  // File rename
  const [renamingFileId, setRenamingFileId] = useState<Id<"projectFiles"> | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [draggingFileId, setDraggingFileId] = useState<Id<"projectFiles"> | null>(null);
  const [dropDirPath, setDropDirPath] = useState<string | null>(null);

  // Create file/directory modal
  const [createFileModal, setCreateFileModal] = useState<"file" | "directory" | null>(null);
  // Share modal
  const [shareOpen, setShareOpen] = useState(false);
  // Options modal
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editorOptions, setEditorOptions] = useState<EditorOptions>(() => loadEditorOptions());

  // Upload
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ processed: number; total: number } | null>(null);

  // PDF panel
  const [pdfCollapsed, setPdfCollapsed] = useState(false);
  const pdfPanelRef = usePanelRef();

  // --- Entrypoint resolution ---
  const entrypointFile = useMemo(() => {
    if (!files || !project) return null;
    // If project has explicit entrypoint, use it (if it still exists)
    if (project.entrypointFileId) {
      const explicit = files.find((f) => f._id === project.entrypointFileId);
      if (explicit) return explicit;
    }
    // Fallback: first root-level .tex file
    return files.find((f) => f.name.endsWith(".tex") && !f.name.includes("/")) ?? null;
  }, [files, project]);

  // Sync project name from query
  useEffect(() => {
    if (project && !editingName) {
      setProjectName(project.name);
    }
  }, [project, editingName]);

  // Auto-open first file
  useEffect(() => {
    if (files && files.length > 0 && !activeFileId) {
      const mainTex = files.find((f) => f.name === "main.tex");
      const firstFile = mainTex ?? files[0];
      setActiveFileId(firstFile._id);
      setContent(firstFile.content);
      setDirty(false);
    }
  }, [files, activeFileId]);

  // Focus name input when editing
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  // Focus rename input
  useEffect(() => {
    if (renamingFileId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingFileId]);

  const activeFile = files?.find((f) => f._id === activeFileId) ?? null;
  const activeFileName = activeFile?.name ?? "";
  const visibleFiles = useMemo(
    () => (files ?? []).filter((f) => !f.name.endsWith("/.gitkeep")),
    [files]
  );

  const { rootDirectories, dirChildren, filesByDir } = useMemo(() => {
    const dirChildren = new Map<string, Set<string>>();
    const mapFilesByDir = new Map<string, typeof visibleFiles>();

    const ensureDir = (dirPath: string) => {
      if (!dirChildren.has(dirPath)) dirChildren.set(dirPath, new Set());
      if (!mapFilesByDir.has(dirPath)) mapFilesByDir.set(dirPath, []);
    };

    const registerDirPath = (dirPath: string) => {
      if (!dirPath) return;
      const parts = dirPath.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        const parent = current;
        current = current ? `${current}/${part}` : part;
        ensureDir(parent);
        ensureDir(current);
        dirChildren.get(parent)?.add(current);
      }
    };

    ensureDir("");
    for (const file of files ?? []) {
      const implicitDir = file.name.endsWith("/.gitkeep")
        ? file.name.slice(0, -"/.gitkeep".length)
        : dirname(file.name);
      registerDirPath(implicitDir);
    }

    for (const file of visibleFiles) {
      const dirPath = dirname(file.name);
      ensureDir(dirPath);
      mapFilesByDir.get(dirPath)?.push(file);
    }

    for (const [key, list] of mapFilesByDir.entries()) {
      list.sort((a, b) => basename(a.name).localeCompare(basename(b.name)));
      mapFilesByDir.set(key, list);
    }

    const sortDirs = (dirs: string[]) => dirs.sort((a, b) => a.localeCompare(b));
    const rootDirs = sortDirs(Array.from(dirChildren.get("") ?? []));

    return {
      rootDirectories: rootDirs,
      dirChildren,
      filesByDir: mapFilesByDir,
    };
  }, [files, visibleFiles]);

  useEffect(() => {
    if (!files) return;
    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const file of files) {
        const dirPath = file.name.endsWith("/.gitkeep")
          ? file.name.slice(0, -"/.gitkeep".length)
          : dirname(file.name);
        if (!dirPath) continue;
        const segments = dirPath.split("/").filter(Boolean);
        let current = "";
        for (const segment of segments) {
          current = current ? `${current}/${segment}` : segment;
          if (!next.has(current)) {
            next.add(current);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [files]);

  const moveFileToDirectory = useCallback(
    async (fileId: Id<"projectFiles">, targetDirPath: string) => {
      const file = files?.find((f) => f._id === fileId);
      if (!file) return;
      const nextName = targetDirPath
        ? `${targetDirPath}/${basename(file.name)}`
        : basename(file.name);
      if (nextName === file.name) return;
      if (files?.some((f) => f._id !== fileId && f.name === nextName)) {
        toast.error(`File already exists: ${nextName}`);
        return;
      }
      await renameFileMut({ fileId, name: nextName });
    },
    [files, renameFileMut]
  );

  const openFile = useCallback(
    (fileId: Id<"projectFiles">) => {
      const file = files?.find((f) => f._id === fileId);
      if (!file) return;
      setActiveFileId(fileId);
      if (isBinaryFile(file.name)) {
        setContent("");
      } else {
        setContent(file.content);
      }
      setDirty(false);
    },
    [files]
  );

  const save = useCallback(async () => {
    if (!activeFileId) return;
    setSaving(true);
    try {
      await updateFileContent({ fileId: activeFileId, content });
      setDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [activeFileId, content, updateFileContent]);

  const compile = useCallback(async (forceRecompile = false) => {
    if (!files || files.length === 0 || !entrypointFile || !project) return;
    // Save first if dirty
    if (dirty) await save();
    setCompiling(true);
    setFromCache(false);

    try {
      const hash = await computeContentHash(files, activeFileId, content);

      // Session-local cache hit
      if (!forceRecompile && lastCompileRef.current?.hash === hash) {
        setPdfUrl(lastCompileRef.current.pdfUrl);
        setFromCache(true);
        setCompiling(false);
        return;
      }

      if (!forceRecompile) {
        const cachedOutput = await convex.query(api.compilations.getByHash, {
          projectId: project._id,
          zipHash: hash,
        });
        if (cachedOutput?.pdfUrl) {
          setPdfUrl(cachedOutput.pdfUrl);
          lastCompileRef.current = { hash, pdfUrl: cachedOutput.pdfUrl };
          setFromCache(true);
          setCompiling(false);
          const panel = pdfPanelRef.current;
          if (pdfCollapsed && panel) panel.expand();
          return;
        }
      }

      // Cache miss (or forced) — compile via service
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project._id, timeout: 120 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("[compile] error body:", JSON.stringify(body));
        const logTail = body?.log ?? body?.error ?? "Unknown compilation error";
        toast.error("Compilation failed", {
          description: logTail.slice(0, 200),
          duration: 8000,
        });
        return;
      }

      const pdfBlob = await res.blob();
      const previousPdfUrl = lastCompileRef.current?.pdfUrl;
      if (previousPdfUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previousPdfUrl);
      }
      const url = URL.createObjectURL(pdfBlob);
      setFromCache(false);
      setPdfUrl(url);
      lastCompileRef.current = { hash, pdfUrl: url };
      const panel = pdfPanelRef.current;
      if (pdfCollapsed && panel) panel.expand();

      // Upload PDF to Convex storage for caching
      try {
        const uploadUrl = await generateCompilationUploadUrl({ projectId: project._id });
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: pdfBlob,
        });
        if (uploadRes.ok) {
          const { storageId } = await uploadRes.json();
          await saveCompilation({
            projectId: project._id,
            zipHash: hash,
            storageId,
          });
        }
      } catch {
        // Caching failure doesn't break the experience
      }
    } finally {
      setCompiling(false);
    }
  }, [
    files,
    activeFileId,
    content,
    dirty,
    save,
    pdfCollapsed,
    entrypointFile,
    project,
    convex,
    pdfPanelRef,
    generateCompilationUploadUrl,
    saveCompilation,
  ]);

  const handleUpload = useCallback(
    async (selectedFiles: FileList | File[]) => {
      if (!selectedFiles || selectedFiles.length === 0 || !project) return;
      const fileArray = Array.from(selectedFiles);

      const resolveName = (file: File) => {
        if (file.webkitRelativePath) {
          const parts = file.webkitRelativePath.split("/");
          if (parts.length > 1) return parts.slice(1).join("/");
        }
        return file.name;
      };

      setUploadProgress({ processed: 0, total: fileArray.length });
      const result = await uploadFilesParallel(fileArray, {
        generateUploadUrl: () => generateFileUploadUrl({ projectId: project._id }),
        createManyText: (args) => createManyText(args as Parameters<typeof createManyText>[0]),
        createManyBinary: (args) => createManyBinary(args as Parameters<typeof createManyBinary>[0]),
        projectId: project._id,
        resolveName,
        onProgress: (processed, total) => setUploadProgress({ processed, total }),
      });
      setUploadProgress(null);

      if (result.failed.length === 0) {
        toast.success(`Uploaded ${result.succeeded} file${result.succeeded !== 1 ? "s" : ""}`);
      } else {
        toast.warning(
          `Uploaded ${result.succeeded}, failed ${result.failed.length}`,
          { description: result.failed.map((f) => f.name).join(", ") }
        );
      }
    },
    [project, generateFileUploadUrl, createManyText, createManyBinary]
  );

  const handleInputUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = event.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;
      await handleUpload(selectedFiles);
      event.target.value = "";
    },
    [handleUpload]
  );

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const files: File[] = [];
    const items = dataTransfer.items;

    // Try to use webkitGetAsEntry for directory support
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
      const readEntry = (entry: FileSystemEntry, basePath: string): Promise<File[]> => {
        return new Promise((resolve) => {
          if (entry.isFile) {
            (entry as FileSystemFileEntry).file((f) => {
              const path = basePath ? `${basePath}/${f.name}` : f.name;
              const fileWithPath = new File([f], path, { type: f.type });
              resolve([fileWithPath]);
            });
          } else if (entry.isDirectory) {
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            reader.readEntries(async (entries) => {
              const nested: File[] = [];
              for (const child of entries) {
                const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                nested.push(...(await readEntry(child, childPath)));
              }
              resolve(nested);
            });
          } else {
            resolve([]);
          }
        });
      };

      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          files.push(...(await readEntry(entry, "")));
        }
      }
      return files;
    }

    // Fallback: plain file list
    return Array.from(dataTransfer.files);
  };

  const onDropOnSidebar = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const internalFileId = event.dataTransfer.getData("application/x-betterleaf-file-id");
      if (internalFileId) {
        await moveFileToDirectory(internalFileId as Id<"projectFiles">, "");
        setDraggingFileId(null);
        setDropDirPath(null);
        return;
      }
      const droppedFiles = await collectDroppedFiles(event.dataTransfer);
      if (droppedFiles.length === 0) return;
      await handleUpload(droppedFiles);
    },
    [handleUpload, moveFileToDirectory]
  );

  const onDragOverSidebar = (event: DragEvent<HTMLDivElement>) => {
    const hasInternalFile = event.dataTransfer.types.includes(
      "application/x-betterleaf-file-id"
    );
    event.preventDefault();
    if (hasInternalFile) {
      if (dropDirPath !== "") setDropDirPath("");
      return;
    }
    if (!dragActive) setDragActive(true);
  };

  const onDragLeaveSidebar = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
      setDropDirPath(null);
    }
  };

  const deleteFile = useCallback(
    async (fileId: Id<"projectFiles">) => {
      await removeFile({ fileId });
      if (activeFileId === fileId) {
        setActiveFileId(null);
        setContent("");
        setDirty(false);
      }
    },
    [activeFileId, removeFile]
  );

  const startRenameFile = (fileId: Id<"projectFiles">, currentName: string) => {
    setRenamingFileId(fileId);
    setRenameInput(currentName);
  };

  const confirmRename = useCallback(async () => {
    if (!renamingFileId || !renameInput.trim()) {
      setRenamingFileId(null);
      return;
    }
    const file = files?.find((f) => f._id === renamingFileId);
    if (!file || renameInput.trim() === file.name) {
      setRenamingFileId(null);
      return;
    }
    await renameFileMut({ fileId: renamingFileId, name: renameInput.trim() });
    setRenamingFileId(null);
  }, [renamingFileId, renameInput, files, renameFileMut]);

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (!project) return;
      try {
        const fileId = await createFile({
          projectId: project._id,
          name,
          content: "",
        });
        setActiveFileId(fileId);
        setContent("");
        setDirty(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create file");
      }
    },
    [project, createFile]
  );

  const handleCreateDirectory = useCallback(
    async (name: string) => {
      if (!project) return;
      try {
        // Directories are virtual — create a placeholder .gitkeep inside
        await createFile({
          projectId: project._id,
          name: `${name}/.gitkeep`,
          content: "",
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create directory");
      }
    },
    [project, createFile]
  );

  const togglePdf = () => {
    const panel = pdfPanelRef.current;
    if (!panel) return;
    if (pdfCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  };

  const startEditingName = () => {
    setNameInput(projectName);
    setEditingName(true);
  };

  const confirmNameEdit = async () => {
    if (nameInput.trim() && project) {
      setProjectName(nameInput.trim());
      await updateProject({ projectId: project._id, name: nameInput.trim() });
    }
    setEditingName(false);
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") confirmNameEdit();
    if (e.key === "Escape") setEditingName(false);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") confirmRename();
    if (e.key === "Escape") setRenamingFileId(null);
  };

  const handleEditorBeforeMount = useCallback((monaco: Monaco) => {
    monaco.languages.register({ id: "latex" });
    monaco.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%.*$/, "comment"],
          [/\$\$/, { token: "keyword", next: "@mathDisplay" }],
          [/\$/, { token: "keyword", next: "@mathInline" }],
          [/\\\[/, { token: "keyword", next: "@mathDisplay" }],
          [/\\\(/, { token: "keyword", next: "@mathInline" }],
          [/\\(begin|end)\{[^}]*\}/, "keyword"],
          [/\\[a-zA-Z@]+\*?/, "tag"],
          [/[{}]/, "delimiter.curly"],
          [/[[\]]/, "delimiter.square"],
          [/[~&]/, "operator"],
          [/#\d?/, "operator"],
        ],
        mathInline: [
          [/[^$\\]+/, "string"],
          [/\\[a-zA-Z@]+\*?/, "string.escape"],
          [/\$/, { token: "keyword", next: "@pop" }],
          [/\\\)/, { token: "keyword", next: "@pop" }],
          [/./, "string"],
        ],
        mathDisplay: [
          [/[^$\\]+/, "string"],
          [/\\[a-zA-Z@]+\*?/, "string.escape"],
          [/\$\$/, { token: "keyword", next: "@pop" }],
          [/\\\]/, { token: "keyword", next: "@pop" }],
          [/./, "string"],
        ],
      },
    });
  }, []);

  // Loading state
  if (project === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium">Project not found</p>
          <Link href="/projects" className="text-primary hover:underline text-sm mt-2 block">
            Back to projects
          </Link>
          <Link href="/auth/login" className="text-muted-foreground hover:underline text-sm mt-1 block">
            Log in to access private projects
          </Link>
        </div>
      </div>
    );
  }

  const accessLevel = project.accessLevel;
  const canEdit = accessLevel === "owner" || accessLevel === "editor" || accessLevel === "public-editor";
  const isOwner = accessLevel === "owner";

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-white px-4">
        {/* Left */}
        <Link
          href="/projects"
          className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent/50 transition-colors text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <Leaf className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
        </div>

        {/* Center — project name */}
        <div className="flex-1 flex justify-center min-w-0">
          {editingName && isOwner ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={confirmNameEdit}
              onKeyDown={handleNameKeyDown}
              className="text-sm font-medium text-foreground bg-transparent border-b-2 border-primary outline-none px-1 py-0.5 text-center max-w-md w-full"
            />
          ) : isOwner ? (
            <button
              onClick={startEditingName}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-md cursor-text"
              title="Click to rename"
            >
              {projectName}
            </button>
          ) : (
            <span className="text-sm font-medium text-foreground truncate max-w-md">
              {projectName}
            </span>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {(accessLevel === "viewer" || accessLevel === "public-viewer") && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">Read-only</Badge>
          )}
          {(accessLevel === "editor" || accessLevel === "public-editor") && (
            <Badge variant="secondary" className="border-emerald-300 bg-emerald-50 text-emerald-700 border">Editor</Badge>
          )}
          {fromCache && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Cached
            </span>
          )}
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          )}
          <div className="flex items-center">
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-r-none"
              onClick={() => compile(false)}
              disabled={compiling || !files || files.length === 0 || !entrypointFile}
            >
              {compiling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {compiling ? "Compiling..." : "Compile"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-8 rounded-l-none border-l border-primary-foreground/20 px-2"
                  disabled={compiling || !files || files.length === 0 || !entrypointFile}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => compile(true)}>
                  Force recompile (ignore cache)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`shrink-0 border-r border-border/60 bg-muted/30 flex flex-col transition-all duration-200 ease-in-out overflow-hidden ${
            sidebarOpen ? "w-60" : "w-0"
          }`}
          onDragOver={onDragOverSidebar}
          onDrop={onDropOnSidebar}
          onDragLeave={onDragLeaveSidebar}
        >
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Files
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* New file / folder buttons */}
          {canEdit && (
            <div className="flex gap-2 px-4 pb-2 shrink-0">
              <button
                onClick={() => setCreateFileModal("file")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                <FilePlus className="h-3.5 w-3.5" />
                New File
              </button>
              <button
                onClick={() => setCreateFileModal("directory")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Folder
              </button>
            </div>
          )}

          {/* File list */}
          <nav className="flex-1 overflow-y-auto px-2">
            {rootDirectories.map((dirPath) => {
              const renderDirectory = (path: string, depth: number): ReactNode => {
                const dirName = basename(path);
                const isExpanded = expandedDirs.has(path);
                const childDirectories = Array.from(dirChildren.get(path) ?? []).sort((a, b) =>
                  a.localeCompare(b)
                );
                const directoryFiles = filesByDir.get(path) ?? [];
                const isDropTarget = dropDirPath === path;

                return (
                  <div key={path}>
                    <button
                      onClick={() =>
                        setExpandedDirs((prev) => {
                          const next = new Set(prev);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        })
                      }
                      onDragOver={(event) => {
                        if (!event.dataTransfer.types.includes("application/x-betterleaf-file-id")) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (dropDirPath !== path) setDropDirPath(path);
                      }}
                      onDrop={async (event) => {
                        const internalFileId = event.dataTransfer.getData(
                          "application/x-betterleaf-file-id"
                        );
                        if (!internalFileId) return;
                        event.preventDefault();
                        event.stopPropagation();
                        await moveFileToDirectory(
                          internalFileId as Id<"projectFiles">,
                          path
                        );
                        setDraggingFileId(null);
                        setDropDirPath(null);
                      }}
                      style={{ paddingLeft: `${8 + depth * 14}px` }}
                      className={`w-full flex items-center gap-1.5 text-left py-1.5 rounded-md text-sm transition-colors ${
                        isDropTarget
                          ? "bg-primary/15 text-primary"
                          : "text-foreground hover:bg-accent/50"
                      }`}
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      />
                      {isExpanded ? (
                        <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />
                      ) : (
                        <Folder className="h-4 w-4 shrink-0 opacity-70" />
                      )}
                      <span className="truncate">{dirName}</span>
                    </button>

                    {isExpanded && (
                      <>
                        {childDirectories.map((child) => renderDirectory(child, depth + 1))}
                        {directoryFiles.map((f) => {
                          const isEntrypoint = entrypointFile?._id === f._id;
                          const isTexFile = f.name.endsWith(".tex");
                          return (
                            <div key={f._id} className="group flex items-center">
                              {renamingFileId === f._id ? (
                                <input
                                  ref={renameInputRef}
                                  value={renameInput}
                                  onChange={(e) => setRenameInput(e.target.value)}
                                  onBlur={confirmRename}
                                  onKeyDown={handleRenameKeyDown}
                                  className="flex-1 text-sm px-2 py-1.5 mx-1 my-0.5 rounded border border-primary bg-white outline-none"
                                />
                              ) : (
                                <>
                                  <button
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.effectAllowed = "move";
                                      event.dataTransfer.setData(
                                        "application/x-betterleaf-file-id",
                                        f._id
                                      );
                                      setDraggingFileId(f._id);
                                    }}
                                    onDragEnd={() => {
                                      setDraggingFileId(null);
                                      setDropDirPath(null);
                                    }}
                                    onClick={() => openFile(f._id)}
                                    style={{ paddingLeft: `${24 + (depth + 1) * 14}px` }}
                                    className={`flex-1 flex items-center gap-2 text-left py-1.5 rounded-md text-sm transition-colors ${
                                      f._id === activeFileId
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "text-foreground hover:bg-accent/50"
                                    } ${draggingFileId === f._id ? "opacity-50" : ""}`}
                                  >
                                    <FileText className="h-4 w-4 shrink-0 opacity-60" />
                                    <span className="truncate">{basename(f.name)}</span>
                                    {isEntrypoint && (
                                      <Target className="h-3 w-3 shrink-0 text-primary" />
                                    )}
                                  </button>
                                  {canEdit && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent/50 text-muted-foreground transition-opacity">
                                          <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-44">
                                        {isOwner && isTexFile && !isEntrypoint && (
                                          <>
                                            <DropdownMenuItem
                                              onClick={() =>
                                                setEntrypoint({ projectId: project._id, fileId: f._id })
                                              }
                                            >
                                              <Target className="mr-2 h-4 w-4" />
                                              Set as entrypoint
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                          </>
                                        )}
                                        <DropdownMenuItem onClick={() => startRenameFile(f._id, f.name)}>
                                          <Pencil className="mr-2 h-4 w-4" />
                                          Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => deleteFile(f._id)}
                                        >
                                          <Trash2 className="mr-2 h-4 w-4" />
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              };

              return renderDirectory(dirPath, 0);
            })}
            {(filesByDir.get("") ?? []).map((f) => {
              const isEntrypoint = entrypointFile?._id === f._id;
              const isTexFile = f.name.endsWith(".tex");
              return (
                <div key={f._id} className="group flex items-center">
                  {renamingFileId === f._id ? (
                    <input
                      ref={renameInputRef}
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={handleRenameKeyDown}
                      className="flex-1 text-sm px-2 py-1.5 mx-1 my-0.5 rounded border border-primary bg-white outline-none"
                    />
                  ) : (
                    <>
                      <button
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-betterleaf-file-id",
                            f._id
                          );
                          setDraggingFileId(f._id);
                        }}
                        onDragEnd={() => {
                          setDraggingFileId(null);
                          setDropDirPath(null);
                        }}
                        onClick={() => openFile(f._id)}
                        className={`flex-1 flex items-center gap-2 text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                          f._id === activeFileId
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-accent/50"
                        } ${draggingFileId === f._id ? "opacity-50" : ""}`}
                      >
                        <FileText className="h-4 w-4 shrink-0 opacity-60" />
                        <span className="truncate">{basename(f.name)}</span>
                        {isEntrypoint && (
                          <Target className="h-3 w-3 shrink-0 text-primary" />
                        )}
                      </button>
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent/50 text-muted-foreground transition-opacity">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {isOwner && isTexFile && !isEntrypoint && (
                              <>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setEntrypoint({ projectId: project._id, fileId: f._id })
                                  }
                                >
                                  <Target className="mr-2 h-4 w-4" />
                                  Set as entrypoint
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem onClick={() => startRenameFile(f._id, f.name)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => deleteFile(f._id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Upload area / drag hint */}
          {canEdit && (
            <div
              className={`px-4 py-2 text-[11px] border-t transition-colors shrink-0 ${
                dragActive
                  ? "text-primary border-primary/50 bg-primary/5"
                  : "text-muted-foreground/60 border-border/40"
              }`}
            >
              {uploadProgress ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">
                    Uploading {uploadProgress.processed}/{uploadProgress.total} files...
                  </span>
                  <div className="h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.processed / uploadProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  className="hover:text-foreground transition-colors"
                >
                  {dragActive ? "Drop files to upload" : "Upload or drag files here"}
                </button>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                onChange={handleInputUpload}
                className="hidden"
              />
            </div>
          )}

          {/* Bottom settings */}
          {isOwner && (
            <div className="px-4 py-2 border-t border-border/40 shrink-0">
              <button
                onClick={() => setOptionsOpen(true)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
            </div>
          )}
        </aside>

        {/* Sidebar toggle (when collapsed) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 flex items-center justify-center w-8 border-r border-border/60 hover:bg-accent/50 text-muted-foreground transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}

        {/* Editor + PDF panels */}
        <Group orientation="horizontal" className="flex-1">
          {/* Editor panel */}
          <Panel defaultSize="50" minSize="30" id="editor">
            <div className="flex flex-col h-full">
              {/* Tab bar */}
              {activeFile && (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-white text-sm shrink-0">
                  <div className="flex items-center gap-2 text-foreground">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{activeFileName}</span>
                    {dirty && (
                      <span className="h-2 w-2 rounded-full bg-primary" title="Unsaved changes" />
                    )}
                  </div>
                  {canEdit && !isBinaryFile(activeFileName) && (
                    <button
                      onClick={save}
                      disabled={!dirty || saving}
                      className="ml-auto px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              )}

              {activeFile && isBinaryFile(activeFileName) ? (
                isImageFile(activeFileName) && activeFile.storageUrl ? (
                  <div className="flex-1 flex items-center justify-center overflow-auto p-6 bg-[#f8f8f8]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeFile.storageUrl}
                      alt={activeFileName}
                      className="max-w-full max-h-full object-contain rounded shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">{activeFileName}</p>
                      <p className="text-xs mt-1">Binary file — cannot be edited</p>
                    </div>
                  </div>
                )
              ) : activeFile ? (
                <Editor
                  beforeMount={handleEditorBeforeMount}
                  theme="vs"
                  language={langFromFilename(activeFileName)}
                  value={content}
                  onChange={(v) => {
                    setContent(v ?? "");
                    setDirty(true);
                  }}
                  options={{
                    minimap: { enabled: editorOptions.minimap },
                    fontSize: 14,
                    wordWrap: editorOptions.wordWrap ? "on" : "off",
                    lineNumbers: editorOptions.lineNumbers ? "on" : "off",
                    padding: { top: 16 },
                    readOnly: !canEdit,
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Select a file to edit</p>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* Resize handle */}
          <Separator className="w-1.5 bg-border/30 hover:bg-primary/30 transition-colors relative flex items-center justify-center">
            <button
              onClick={togglePdf}
              className="absolute z-10 w-5 h-8 bg-white border border-border/60 hover:border-primary/40 rounded-sm flex items-center justify-center text-muted-foreground hover:text-primary transition-colors shadow-sm"
              title={pdfCollapsed ? "Show PDF" : "Hide PDF"}
            >
              {pdfCollapsed ? (
                <ChevronLeft className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          </Separator>

          {/* PDF panel */}
          <Panel
            defaultSize="50"
            minSize="20"
            collapsible
            panelRef={pdfPanelRef}
            onResize={(size) => {
              setPdfCollapsed(size.asPercentage === 0);
            }}
            id="pdf"
          >
            <PdfViewer pdfUrl={pdfUrl} />
          </Panel>
        </Group>
      </div>

      <CreateFileModal
        open={createFileModal !== null}
        onClose={() => setCreateFileModal(null)}
        mode={createFileModal ?? "file"}
        onCreate={createFileModal === "directory" ? handleCreateDirectory : handleCreateFile}
      />
      {project && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={project._id}
          currentPublicAccess={project.publicAccess ?? "none"}
        />
      )}
      <OptionsModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        onApply={setEditorOptions}
        compileSettings={{
          compiler: project.compiler ?? "pdflatex",
          haltOnError: project.haltOnError ?? false,
        }}
        onApplyCompileSettings={(settings) => {
          updateProject({
            projectId: project._id,
            compiler: settings.compiler,
            haltOnError: settings.haltOnError,
          });
        }}
      />
    </div>
  );
}
