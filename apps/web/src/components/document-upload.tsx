"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { prepareUpload, registerUpload } from "@/lib/actions/documents";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Field, Input, Notice } from "./ui";

const MAX = 25 * 1024 * 1024;

export function DocumentUpload({ matterId }: { matterId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim();
    if (!file) return setMessage({ tone: "bad", text: "Choose a file." });
    if (file.size > MAX) return setMessage({ tone: "bad", text: "Files can be up to 25 MB." });
    setBusy(true);
    setMessage(null);
    try {
      const prep = await prepareUpload({ matterId, filename: file.name, mime: file.type, size: file.size });
      if (!prep.ok) return setMessage({ tone: "bad", text: prep.error });
      const { error } = await supabaseBrowser().storage.from("documents")
        .upload(prep.path, file, { contentType: file.type, upsert: false });
      if (error) return setMessage({ tone: "bad", text: "Upload failed. Please try again." });
      const reg = await registerUpload({
        matterId, documentId: prep.documentId, path: prep.path, title: title || file.name, mime: file.type, size: file.size,
      });
      if (!reg.ok) return setMessage({ tone: "bad", text: reg.error ?? "Could not save the document." });
      form.reset();
      setMessage({ tone: "ok", text: "Document uploaded." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="File" hint="PDF, Word, Excel, text or image · up to 25 MB · stored privately">
        <Input name="file" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg" />
      </Field>
      <Field label="Title (optional)"><Input name="title" maxLength={300} /></Field>
      <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Uploading…" : "Upload"}</Button>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
