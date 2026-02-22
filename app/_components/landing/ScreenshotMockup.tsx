"use client";

export function ScreenshotMockup() {
  return (
    <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111] shadow-2xl overflow-hidden">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1e1e1e] border-b border-white/5">
        <div className="w-3 h-3 rounded-full bg-white/10" />
        <div className="w-3 h-3 rounded-full bg-white/10" />
        <div className="w-3 h-3 rounded-full bg-white/10" />
        <div className="ml-3 flex-1 h-6 rounded-md bg-white/5 flex items-center px-3">
          <span className="text-xs text-white/30">localhost:3000/projects/thesis</span>
        </div>
      </div>
      {/* Fake editor UI */}
      <div className="flex h-56">
        {/* Editor pane */}
        <div className="flex-1 p-4 border-r border-white/5 font-mono text-xs space-y-1">
          <p className="text-[#569cd6]">\documentclass<span className="text-white/60">&#123;article&#125;</span></p>
          <p className="text-[#569cd6]">\usepackage<span className="text-white/60">&#123;graphicx&#125;</span></p>
          <p className="text-white/30 mt-2">&nbsp;</p>
          <p className="text-[#569cd6]">\begin<span className="text-white/60">&#123;document&#125;</span></p>
          <p className="text-[#6a9955]">% Your thesis, no limits</p>
          <p className="text-white/70">\section&#123;Introduction&#125;</p>
          <p className="text-white/50">The quick brown fox...</p>
          <p className="text-[#569cd6]">\end<span className="text-white/60">&#123;document&#125;</span></p>
        </div>
        {/* PDF preview pane */}
        <div className="flex-1 bg-white/[0.03] p-4 flex flex-col items-center justify-center">
          <div className="w-24 h-32 bg-white/10 rounded shadow-inner flex items-center justify-center">
            <span className="text-[10px] text-white/20">PDF Preview</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500/80" />
            <span className="text-[10px] text-emerald-400/70">Compiled in 0.8s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
