"use client";

import {
  Infinity as InfinityIcon,
  Server,
  Users,
  Code2,
  FileText,
} from "lucide-react";
import { useInView } from "./useInView";
import { cn } from "@/lib/utils";

const bullets = [
  { icon: InfinityIcon, text: "Unlimited compile time — no artificial limits" },
  { icon: Server, text: "Self-hosted — your data stays on your infrastructure" },
  { icon: Users, text: "Real-time collaboration with multiple users" },
  { icon: Code2, text: "Monaco editor — the same engine behind VS Code" },
  { icon: FileText, text: "Live PDF preview with instant feedback" },
];

export function Solution() {
  const { ref, isInView } = useInView();

  return (
    <section ref={ref} className="py-24 px-6 bg-[#0a0f0d]">
      <div className="mx-auto max-w-4xl">
        <h2
          className={cn(
            "text-3xl md:text-4xl font-bold tracking-tight text-white transition-all duration-700",
            isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          )}
        >
          Meet{" "}
          <span className="text-primary">betterleaf</span>
        </h2>
        <p className="mt-4 text-white/50 max-w-lg leading-relaxed">
          Everything you need for serious LaTeX work — without the limitations
          of cloud-only editors.
        </p>

        <ul className="mt-10 space-y-5">
          {bullets.map((item, i) => (
            <li
              key={item.text}
              className={cn(
                "flex items-start gap-4 transition-all duration-700",
                isInView
                  ? "opacity-100 translate-x-0"
                  : "opacity-0 -translate-x-6"
              )}
              style={{ transitionDelay: `${(i + 1) * 100}ms` }}
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-white/70 text-lg">{item.text}</span>
            </li>
          ))}
        </ul>

        {/* Placeholder for large screenshot */}
        <div
          className={cn(
            "mt-16 rounded-xl border border-white/10 bg-white/[0.02] h-64 flex items-center justify-center transition-all duration-1000",
            isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          )}
          style={{ transitionDelay: "600ms" }}
        >
          <span className="text-white/20 text-sm">Screenshot placeholder — full editor view</span>
        </div>
      </div>
    </section>
  );
}
