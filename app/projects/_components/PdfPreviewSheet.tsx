"use client";

import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Modal } from "@/components/ui/modal";

const PdfViewer = dynamic(() => import("@/app/components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-muted/20">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  ),
});

interface PdfPreviewSheetProps {
  open: boolean;
  onClose: () => void;
  projectId: Id<"projects"> | null;
  projectName: string;
}

function formatCompiledAt(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PdfPreviewSheet({
  open,
  onClose,
  projectId,
  projectName,
}: PdfPreviewSheetProps) {
  const result = useQuery(
    api.compilations.getLatestPdfUrl,
    open && projectId ? { projectId } : "skip"
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="flex h-screen w-screen max-w-none flex-col rounded-none p-0"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-white px-4 pr-12">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {projectName}
          </p>
          {result && (
            <p className="truncate text-[11px] text-muted-foreground">
              Compiled {formatCompiledAt(result.createdAt)}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col">
        {result === undefined ? (
          <div className="flex flex-1 items-center justify-center bg-muted/20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : result === null ? (
          <div className="flex flex-1 items-center justify-center bg-muted/20 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              No compiled PDF is available for this project yet.
            </p>
          </div>
        ) : (
          <PdfViewer pdfUrl={result.pdfUrl} />
        )}
      </div>
    </Modal>
  );
}
