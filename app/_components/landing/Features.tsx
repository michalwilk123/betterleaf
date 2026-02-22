"use client";

import {
  Zap,
  Shield,
  GitBranch,
  MonitorSmartphone,
  Package,
  Paintbrush,
} from "lucide-react";
import { useInView } from "./useInView";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Zap,
    title: "Blazing Fast Compiles",
    description: "No timeouts. Your TeX Live installation, your hardware, your rules.",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description: "Self-host on your own server. Your research never leaves your network.",
  },
  {
    icon: GitBranch,
    title: "Git Integration",
    description: "Built-in version control so you never lose a single change.",
  },
  {
    icon: MonitorSmartphone,
    title: "Works Everywhere",
    description: "Responsive web editor that works on desktop, tablet, and mobile.",
  },
  {
    icon: Package,
    title: "Docker Ready",
    description: "One docker-compose command to get a full LaTeX environment running.",
  },
  {
    icon: Paintbrush,
    title: "Modern Editor",
    description: "Monaco editor with syntax highlighting, autocomplete, and snippets.",
  },
];

export function Features() {
  const { ref, isInView } = useInView();

  return (
    <section ref={ref} className="py-24 px-6 bg-white">
      <div className="mx-auto max-w-5xl">
        <h2
          className={cn(
            "text-3xl md:text-4xl font-bold tracking-tight text-foreground text-center transition-all duration-700",
            isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          )}
        >
          Everything you need
        </h2>
        <p className="mt-4 text-center text-muted-foreground max-w-lg mx-auto">
          A complete LaTeX authoring platform, built for researchers and students.
        </p>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={cn(
                "rounded-xl border border-border bg-card p-6 transition-all duration-700 hover:shadow-md hover:border-primary/20",
                isInView
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6"
              )}
              style={{ transitionDelay: `${(i + 1) * 80}ms` }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
