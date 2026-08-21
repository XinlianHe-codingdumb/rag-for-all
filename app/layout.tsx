import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "@fontsource-variable/mona-sans/wdth.css";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAG FOR ALL — See How RAG Works, Step by Step",
  description:
    "See the evidence behind the answer, then explore every RAG hand-off from document to grounded response.",
  icons: {
    icon: [{ url: "/brand-r.png", type: "image/png", sizes: "1254x1254" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "RAG FOR ALL",
    description: "See the evidence behind the answer.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "RAG FOR ALL turns a generic AI agent into your agent" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RAG FOR ALL",
    description: "See the evidence behind the answer.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geistMono.variable}>
        {children}
      </body>
    </html>
  );
}
