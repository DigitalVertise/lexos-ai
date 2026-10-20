"use client";

import { useState } from "react";
import { Button } from "./ui";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="secondary" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
    }}>
      {copied ? "Copied" : label}
    </Button>
  );
}
