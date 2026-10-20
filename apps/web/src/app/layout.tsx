import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LexOS AI — AI legal team for law firms", template: "%s · LexOS AI" },
  description: "Hire AI legal assistants for intake, drafting, client communications, billing, contract review and research — inside a secure workspace for your firm.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
