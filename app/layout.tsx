import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "@fontsource-variable/mona-sans/wdth.css";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAG FOR ALL — See what your RAG is thinking",
  description:
    "A visual RAG laboratory for learning, testing, and comparing every step from document to answer.",
  openGraph: {
    title: "RAG FOR ALL",
    description: "See what your RAG is thinking.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "RAG FOR ALL visual pipeline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RAG FOR ALL",
    description: "See what your RAG is thinking.",
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
