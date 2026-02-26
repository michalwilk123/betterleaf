"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalBlock } from "./TerminalBlock";
import { ScreenshotMockup } from "./ScreenshotMockup";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center bg-[#0a0f0d] overflow-hidden">
      {/* Radial teal glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative mx-auto max-w-6xl w-full px-6 py-32 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left — copy */}
        <div className="animate-fade-up">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.08]">
            Your thesis deserves
            <br />
            better than a{" "}
            <span className="text-primary">compile limit.</span>
          </h1>

          <p className="mt-6 text-lg text-white/50 max-w-md leading-relaxed">
            betterleaf is a modern, self-hosted Overleaf alternative for LaTeX
            document generation and online PDF compilation. No compile timeouts.
            No vendor lock-in. Just your work, on your terms.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Button asChild size="lg" className="text-base">
              <Link href="/enter">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-base border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white">
              <a href="https://github.com/michalwilk123/betterleaf" target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
        </div>

        {/* Right — stacked visuals */}
        <div className="relative hidden lg:block animate-fade-up [animation-delay:200ms]">
          {/* Terminal (background, slightly offset) */}
          <div className="absolute -top-4 -left-4 opacity-60 rotate-[-2deg] scale-95">
            <TerminalBlock />
          </div>
          {/* Browser mockup (foreground) */}
          <div className="relative z-10 translate-x-8 translate-y-8">
            <ScreenshotMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
