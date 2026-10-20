import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notionPageId, pageText } from "./integrations/notion";
import type { DocumentRow } from "./types";

export const DOCUMENT_BUCKET = "documents";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/png",
  "image/jpeg",
]);

/** Storage path for a document. The first segment must be the org ID (storage RLS). */
export function storagePathFor(orgId: string, documentId: string, filename: string): string {
  const safe = filename.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+/, "")
    .slice(-120) || "file";
  return `${orgId}/${documentId}/${safe}`;
}

/** Path must belong to the org and the document; prevents registering someone else's object. */
export function isValidStoragePath(path: string, orgId: string, documentId: string): boolean {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === orgId && parts[1] === documentId && !parts[2].includes("..") && parts[2].length > 0;
}

/** Short-lived download link, created only after the server has authorized access. */
export async function signedUrl(supabase: SupabaseClient, path: string, seconds = 120): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

export async function extractText(
  supabase: SupabaseClient, doc: DocumentRow, maxChars: number, opts: { notionToken?: string } = {},
): Promise<string> {
  if (doc.source === "link") {
    const pageId = doc.url ? notionPageId(doc.url) : null;
    if (pageId && opts.notionToken) {
      try {
        const text = await pageText(opts.notionToken, pageId, maxChars);
        return text || "[The Notion page is empty.]";
      } catch {
        return "[Notion page could not be read. Make sure the page is shared with the firm's LexOS integration in Notion (••• → Connections).]";
      }
    }
    if (pageId) return "[Notion page — connect Notion in Settings → Integrations so assistants can read it.]";
    return `[Linked document: ${doc.url}. Content not available to the assistant.]`;
  }
  if (!doc.storage_path) return "[File missing]";
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(doc.storage_path);
  if (error || !data) return "[File could not be read]";
  const buffer = new Uint8Array(await data.arrayBuffer());
  let text = "";
  try {
    if (doc.mime_type === "application/pdf") {
      const { extractText: pdfText } = await import("unpdf");
      const result = await pdfText(buffer, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else if (doc.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(buffer) })).value;
    } else if (doc.mime_type === "text/plain") {
      text = new TextDecoder().decode(buffer);
    } else {
      return `[${doc.mime_type ?? "This file type"} cannot be read by the assistant yet. Upload a PDF, Word (.docx) or text version.]`;
    }
  } catch {
    return "[File could not be read]";
  }
  text = text.replace(/\u0000/g, "").trim();
  if (!text) return "[No text found — the file may be a scan. Upload a text-based PDF or Word file.]";
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…truncated]` : text;
}
