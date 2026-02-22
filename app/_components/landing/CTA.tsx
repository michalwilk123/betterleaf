"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInView } from "./useInView";
import { cn } from "@/lib/utils";

export function CTA() {
  const { ref, isInView } = useInView();

  return (
    <section
      ref={ref}
      className="py-24 px-6 bg-gradient-to-br from-primary to-emerald-700"
    >
      <div
        className={cn(
          "mx-auto max-w-2xl text-center transition-all duration-700",
          isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        )}
      >
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
          Ready to leave the limits behind?
        </h2>
        <p className="mt-4 text-white/70 text-lg">
          Set up your own betterleaf instance in minutes with Docker.
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="bg-white text-primary hover:bg-white/90 text-base font-semibold"
          >
            <Link href="/enter">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
