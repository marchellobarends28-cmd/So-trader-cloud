import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grok-5 Autonomous AI Trading | MetaTrader 5 Multi-Agent Bridge",
  description:
    "Autonomous multi-agent algorithmic trading application connected to MetaTrader 5 with self-reflective Dreaded Analysis memory bank.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
