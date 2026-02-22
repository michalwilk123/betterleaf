import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import ConvexClientProvider from "./ConvexClientProvider";
import "./globals.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "BetterLeaf";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://betterleaf.micwilk.com";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "BetterLeaf is an Overleaf alternative for LaTeX document generation and PDF compilation online. Self-hosted, open source, and built for academic writing.",
  keywords: [
    "LaTeX",
    "LaTeX editor",
    "online LaTeX editor",
    "Overleaf alternative",
    "better overleaf",
    "Better Overleaf",
    "self-hosted LaTeX",
    "open source LaTeX editor",
    "LaTeX collaboration",
    "real-time LaTeX collaboration",
    "LaTeX document generation",
    "generate PDF from LaTeX online",
    "compile LaTeX online",
    "LaTeX PDF generator",
    "thesis LaTeX editor",
    "Docker LaTeX editor",
    "academic writing tool",
    APP_NAME,
  ],
  alternates: {
    canonical: APP_URL,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: APP_NAME,
    description:
      "An Overleaf alternative for LaTeX document generation. Generate PDFs from LaTeX online with self-hosted, open source collaboration.",
    siteName: APP_NAME,
    type: "website",
    url: APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description:
      "BetterLeaf is a better Overleaf alternative for LaTeX document generation and PDF compilation online.",
  },
  category: "technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
