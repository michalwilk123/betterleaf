"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0a0f0d]/80 backdrop-blur-xl border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 group">
          <Leaf className="h-6 w-6 text-primary transition-transform group-hover:rotate-12" />
          <span className="text-lg font-bold text-white tracking-tight">
            betterleaf
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild className="text-white/70 hover:text-white hover:bg-white/10">
            <Link href="/enter">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/enter">Get Started</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}
