import pLimit from "p-limit";

const BINARY_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "pdf", "bmp", "eps", "svg", "zip",
]);

export function isBinaryFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || attempt >= maxRetries) return res;
      if (res.status !== 429 && res.status < 500) return res;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
    }
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
}

interface UploadFilesOptions {
  generateUploadUrl: () => Promise<string>;
  createManyText: (args: {
    projectId: string;
    files: { name: string; content: string }[];
  }) => Promise<unknown>;
  createManyBinary: (args: {
    projectId: string;
    files: { name: string; storageId: string }[];
  }) => Promise<unknown>;
  projectId: string;
  resolveName?: (file: File) => string;
  onProgress?: (processed: number, total: number) => void;
}

export interface UploadResult {
  succeeded: number;
  failed: { name: string; error: string }[];
}

export async function uploadFilesParallel(
  files: File[],
  options: UploadFilesOptions
): Promise<UploadResult> {
  const {
    generateUploadUrl,
    createManyText,
    createManyBinary,
    projectId,
    resolveName = (f) => f.name,
    onProgress,
  } = options;

  const limit = pLimit(5);
  const textFiles: { name: string; content: string }[] = [];
  const binaryFiles: { name: string; storageId: string }[] = [];
  const failed: { name: string; error: string }[] = [];
  let processed = 0;
  const total = files.length;

  onProgress?.(0, total);

  const tasks = files.map((file) =>
    limit(async () => {
      const name = resolveName(file);
      try {
        if (isBinaryFile(name)) {
          const uploadUrl = await generateUploadUrl();
          const res = await fetchWithRetry(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
          const { storageId } = await res.json();
          binaryFiles.push({ name, storageId });
        } else {
          const content = await file.text();
          textFiles.push({ name, content });
        }
      } catch (err) {
        failed.push({
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      processed++;
      onProgress?.(processed, total);
    })
  );

  await Promise.allSettled(tasks);

  // Batch-insert collected results
  if (textFiles.length > 0) {
    try {
      await createManyText({ projectId, files: textFiles });
    } catch (err) {
      for (const f of textFiles) {
        failed.push({
          name: f.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return { succeeded: binaryFiles.length, failed };
    }
  }

  if (binaryFiles.length > 0) {
    try {
      await createManyBinary({ projectId, files: binaryFiles });
    } catch (err) {
      for (const f of binaryFiles) {
        failed.push({
          name: f.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return { succeeded: textFiles.length, failed };
    }
  }

  const succeeded = textFiles.length + binaryFiles.length;
  return { succeeded, failed };
}
