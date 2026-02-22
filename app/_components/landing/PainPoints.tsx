"use client";

import { Clock, WifiOff } from "lucide-react";
import { useInView } from "./useInView";
import { cn } from "@/lib/utils";

const pains = [
  {
    icon: Clock,
    quote: "My thesis takes 3 minutes to compile, but Overleaf kills it at 1 minute on free and 4 on paid.",
    label: "Compile timeouts",
  },
  {
    icon: WifiOff,
    quote: "Tried to work on a train, realized I can't do anything without internet because everything's in the cloud.",
    label: "No offline access",
  },
];

export function PainPoints() {
  const { ref, isInView } = useInView();

  return (
    <section ref={ref} className="py-24 px-6 bg-white">
      <div className="mx-auto max-w-4xl text-center">
        <h2
          className={cn(
            "text-3xl md:text-4xl font-bold tracking-tight text-foreground transition-all duration-700",
            isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          )}
        >
          Sound familiar?
        </h2>
        <div className="mt-12 grid md:grid-cols-2 gap-6">
          {pains.map((pain, i) => (
            <div
              key={pain.label}
              className={cn(
                "rounded-xl border-l-4 border-l-red-500 border border-border bg-card p-6 text-left transition-all duration-700",
                isInView
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6"
              )}
              style={{ transitionDelay: `${(i + 1) * 150}ms` }}
            >
              <div className="flex items-center gap-3 mb-3">
                <pain.icon className="h-5 w-5 text-red-500" />
                <span className="text-sm font-semibold text-red-500 uppercase tracking-wider">
                  {pain.label}
                </span>
              </div>
              <p className="text-foreground/70 leading-relaxed italic">
                &ldquo;{pain.quote}&rdquo;
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
