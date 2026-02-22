"use client";

import { cn } from "@/lib/utils";

type AuthCardShellProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
};

export function AuthCardShell({
  title,
  description,
  children,
  className,
}: AuthCardShellProps) {
  return (
    <section
      className={cn(
        "w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm",
        className
      )}
    >
      <header className="mb-6 space-y-1">
        <h2 className="text-2xl font-semibold text-card-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
