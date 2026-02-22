import type { Metadata } from "next";
import { Navbar } from "./_components/landing/Navbar";
import { Hero } from "./_components/landing/Hero";
import { PainPoints } from "./_components/landing/PainPoints";
import { Solution } from "./_components/landing/Solution";
import { Features } from "./_components/landing/Features";
import { CTA } from "./_components/landing/CTA";
import { Leaf } from "lucide-react";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "BetterLeaf";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://betterleaf.micwilk.com";

export const metadata: Metadata = {
  title: "Overleaf Alternative for LaTeX PDF Generation Online",
  description:
    "BetterLeaf is a better Overleaf alternative for LaTeX document generation. Generate PDF from LaTeX online with a self-hosted, collaborative editor.",
};

export default function LandingPage() {
  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: APP_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: APP_URL,
    description:
      "An Overleaf alternative for LaTeX document generation and online PDF compilation.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    keywords: [
      "Overleaf alternative",
      "better overleaf",
      "latex document generation",
      "generate pdf from latex online",
      "self-hosted LaTeX editor",
      "open source LaTeX collaboration",
    ],
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd),
        }}
      />
      <Navbar />
      <Hero />
      <PainPoints />
      <Solution />
      <Features />
      <CTA />

      {/* Footer */}
      <footer className="py-8 px-6 bg-[#0a0f0d] border-t border-white/5">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Leaf className="h-4 w-4" />
            <span>betterleaf</span>
          </div>
          <p className="text-white/30 text-sm">
            Open source LaTeX collaboration.
          </p>
        </div>
      </footer>
    </main>
  );
}
