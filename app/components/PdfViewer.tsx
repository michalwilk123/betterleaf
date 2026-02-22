"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Download, Minus, Plus } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3.0;
const DEFAULT_SCALE = 1.2;
const PAGE_BATCH_SIZE = 6;

export default function PdfViewer({ pdfUrl }: { pdfUrl?: string }) {
  const [numPages, setNumPages] = useState(0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setRenderedPages(Math.min(n, PAGE_BATCH_SIZE));
      setCurrentPage(1);
    },
    []
  );

  const zoomIn = () => setScale((s) => Math.min(s + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setScale((s) => Math.max(s - ZOOM_STEP, ZOOM_MIN));
  const fitWidth = () => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 32;
    setScale(containerWidth / 612);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = Number(entry.target.getAttribute("data-page"));
            if (pageNum) {
              setCurrentPage(pageNum);
            }
          }
        }
      },
      { root: container, threshold: 0.5 }
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [numPages, scale]);

  useEffect(() => {
    if (numPages === 0 || renderedPages >= numPages) return;
    const timeoutId = window.setTimeout(() => {
      setRenderedPages((prev) => Math.min(numPages, prev + PAGE_BATCH_SIZE));
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [numPages, renderedPages]);

  if (!pdfUrl) {
    return (
      <div className="flex flex-col h-full bg-muted/30">
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Compile to see PDF output</p>
        </div>
      </div>
    );
  }

  const pageGap = Math.max(10, Math.round(10 * scale));

  return (
    <div className="flex flex-col h-full bg-muted/30">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-border/60 text-sm text-foreground flex-shrink-0">
        <button
          onClick={zoomOut}
          className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={fitWidth}
          className="px-2 py-1 rounded hover:bg-accent/50 text-xs text-muted-foreground"
          title="Fit to width"
        >
          Fit
        </button>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          Page {currentPage} of {numPages}
        </span>

        <a
          href={pdfUrl}
          download
          className="ml-2 p-1 rounded hover:bg-accent/50 text-muted-foreground"
          title="Download PDF"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>

      {/* Scrollable pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto flex flex-col items-center gap-4 py-4 bg-muted/20"
      >
        <Document
          key={pdfUrl}
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
        >
          {Array.from({ length: renderedPages }, (_, i) => (
            <div
              key={i + 1}
              data-page={i + 1}
              ref={(el) => {
                if (el) pageRefs.current.set(i + 1, el);
                else pageRefs.current.delete(i + 1);
              }}
              className="shadow-md rounded-sm overflow-hidden"
              style={{ marginBottom: i + 1 === numPages ? 0 : pageGap }}
            >
              <Page pageNumber={i + 1} scale={scale} />
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}
