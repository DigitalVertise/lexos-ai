import "server-only";

/**
 * Notion via the firm's own internal integration token (Notion → Settings →
 * Connections → Develop or manage integrations). The firm shares the pages it
 * wants LexOS to read with that integration; nothing else is visible to us.
 * Docs: https://developers.notion.com/reference
 */
const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export interface NotionTokens { token: string }

export class NotionError extends Error {}

/** Internal integration secrets start with "ntn_" (new) or "secret_" (legacy). */
export function looksLikeNotionToken(t: string): boolean {
  return /^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(t.trim());
}

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!res.ok) throw new NotionError(`Notion ${res.status}: ${json.code ?? ""}`.trim());
  return json;
}

/** Validates the token; returns the workspace name for display. */
export async function whoAmI(token: string): Promise<string> {
  const me = await call<{ bot?: { workspace_name?: string } ; name?: string }>(token, "users/me");
  return me.bot?.workspace_name || me.name || "Notion workspace";
}

/** Page ID from a Notion URL (notion.so, www.notion.so or *.notion.site), or null. */
export function notionPageId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!(host === "notion.so" || host === "www.notion.so" || host.endsWith(".notion.site") || host === "app.notion.com")) return null;
  const candidate = (u.searchParams.get("p") ?? u.pathname).replace(/-/g, "");
  const m = candidate.match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type RichText = { plain_text?: string }[];
type Block = { id: string; type: string; has_children?: boolean } & Record<string, unknown>;

const plain = (rt: unknown) => ((rt as RichText | undefined) ?? []).map((t) => t.plain_text ?? "").join("");

/** One block as a line of text (headings, lists, to-dos, quotes, tables, code…). */
export function blockToText(b: Block): string {
  const v = b[b.type] as Record<string, unknown> | undefined;
  if (!v) return "";
  const text = plain(v.rich_text);
  switch (b.type) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `- [${v.checked ? "x" : " "}] ${text}`;
    case "quote": case "callout": return `> ${text}`;
    case "code": return `\`\`\`\n${text}\n\`\`\``;
    case "table_row": return `| ${((v.cells as RichText[] | undefined) ?? []).map(plain).join(" | ")} |`;
    case "child_page": return `[Sub-page: ${String(v.title ?? "")}]`;
    case "divider": return "---";
    default: return text;
  }
}

export interface SearchHit { id: string; title: string; url: string; lastEdited: string }

export async function searchPages(token: string, query: string): Promise<SearchHit[]> {
  const res = await call<{ results: { id: string; url: string; last_edited_time: string; properties?: Record<string, { type: string; title?: RichText }> }[] }>(
    token, "search", { method: "POST", body: { query: query.slice(0, 100), filter: { property: "object", value: "page" }, page_size: 10 } },
  );
  return res.results.map((p) => {
    const titleProp = Object.values(p.properties ?? {}).find((x) => x.type === "title");
    return { id: p.id, url: p.url, lastEdited: p.last_edited_time, title: plain(titleProp?.title) || "Untitled" };
  });
}

type PageRes = { id: string; url: string; last_edited_time: string; properties?: Record<string, { type: string; title?: RichText }> };

const pageTitle = (p: PageRes) =>
  plain(Object.values(p.properties ?? {}).find((x) => x.type === "title")?.title) || "Untitled";

/** Confirms the integration can see the page; returns its canonical URL and title. */
export async function getPage(token: string, pageId: string): Promise<SearchHit> {
  const p = await call<PageRes>(token, `pages/${pageId}`);
  return { id: p.id, url: p.url, lastEdited: p.last_edited_time, title: pageTitle(p) };
}

/** Page text for the assistants: walks blocks (2 levels deep) up to maxChars. */
export async function pageText(token: string, pageId: string, maxChars: number): Promise<string> {
  const lines: string[] = [];
  let chars = 0;
  let calls = 0;
  async function walk(blockId: string, depth: number) {
    let cursor: string | undefined;
    do {
      if (chars >= maxChars || calls >= 25) return;
      calls++;
      const q = new URLSearchParams({ page_size: "100", ...(cursor ? { start_cursor: cursor } : {}) });
      const res = await call<{ results: Block[]; has_more: boolean; next_cursor: string | null }>(token, `blocks/${blockId}/children?${q}`);
      for (const b of res.results) {
        const line = blockToText(b);
        if (line) { lines.push("  ".repeat(depth) + line); chars += line.length + 1; }
        if (b.has_children && depth < 2 && b.type !== "child_page" && b.type !== "child_database") await walk(b.id, depth + 1);
        if (chars >= maxChars) return;
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
  }
  await walk(pageId, 0);
  const text = lines.join("\n").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…truncated]` : text;
}
