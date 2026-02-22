"use client";

export function TerminalBlock() {
  return (
    <div className="w-full max-w-lg rounded-lg border border-red-900/40 bg-[#1a1a1a] shadow-2xl font-mono text-sm overflow-hidden">
      {/* Terminal chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#252525] border-b border-white/5">
        <div className="w-3 h-3 rounded-full bg-red-500/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <div className="w-3 h-3 rounded-full bg-green-500/80" />
        <span className="ml-2 text-xs text-white/40">overleaf — compile output</span>
      </div>
      {/* Terminal content */}
      <div className="p-4 space-y-1 text-[13px] leading-relaxed">
        <p className="text-white/50">$ latexmk -pdf main.tex</p>
        <p className="text-white/60">Running pdflatex...</p>
        <p className="text-white/60">Processing chapter_3.tex...</p>
        <p className="text-white/60">Processing bibliography...</p>
        <p className="text-red-400 font-semibold mt-2">
          ! LaTeX Error: Compile timeout — exceeded 1 minute limit.
        </p>
        <p className="text-red-400/80">
          Your project took too long to compile. Consider upgrading
        </p>
        <p className="text-red-400/80">
          to a paid plan for extended compile time.
        </p>
        <p className="text-yellow-500/70 mt-2">
          → Free plan: 1 min &nbsp;|&nbsp; Pro plan: 4 min &nbsp;|&nbsp; betterleaf: ∞
        </p>
      </div>
    </div>
  );
}
