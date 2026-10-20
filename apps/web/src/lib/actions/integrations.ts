"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, LAWYER_ROLES, hasRole, requireWorkspace, type Workspace } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import {
  getPage, looksLikeNotionToken, NotionError, notionPageId, whoAmI, type NotionTokens,
} from "@/lib/integrations/notion";
import { deleteConnection, loadConnection, reportConnection, saveConnection } from "@/lib/integrations/store";
import {
  bigin, BiginError, fromBiginContact, moduleFor, revoke, toBiginRecord, writeResult,
  type BiginContact, type ZohoTokens,
} from "@/lib/integrations/zoho";
import type { Client } from "@/lib/types";

// ---------------------------------------------------------------------------
// Zoho Bigin
// ---------------------------------------------------------------------------

async function biginConnection(ws: Workspace) {
  const conn = await loadConnection<ZohoTokens>(ws.supabase, ws.org.id, "zoho_bigin");
  if (!conn?.apiDomain) return null;
  return { tokens: conn.tokens, apiDomain: conn.apiDomain };
}

/** Run a Bigin call, persisting refreshed tokens and recording failures on the connection. */
async function withBigin<T>(ws: Workspace, fn: (c: { tokens: ZohoTokens; apiDomain: string }) => Promise<{ value: T; tokens: ZohoTokens; refreshed: boolean }>) {
  const conn = await biginConnection(ws);
  if (!conn) return { ok: false as const, error: "Zoho Bigin is not connected. An admin can connect it in Settings → Integrations." };
  try {
    const r = await fn(conn);
    if (r.refreshed) await reportConnection(ws.supabase, ws.org.id, "zoho_bigin", "connected", null, r.tokens);
    return { ok: true as const, value: r.value };
  } catch (err) {
    const msg = err instanceof BiginError || (err as Error).message?.startsWith("Zoho") ? (err as Error).message : "Bigin did not respond";
    await reportConnection(ws.supabase, ws.org.id, "zoho_bigin", "error", msg);
    return { ok: false as const, error: msg };
  }
}

export async function syncClientToBigin(data: FormData) {
  const ws = await requireWorkspace();
  const id = z.string().uuid().parse(data.get("id"));
  const { data: client } = await ws.supabase.from("clients").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<Client>();
  if (!client) redirect("/clients");
  const biginModule = moduleFor(client);
  const record = toBiginRecord(client);

  const result = await withBigin(ws, async (c) => {
    const path = client.crm_id ? `${biginModule}/${client.crm_id}` : biginModule;
    const r = await bigin<Parameters<typeof writeResult>[0]>(c, path, {
      method: client.crm_id ? "PUT" : "POST",
      body: { data: [record], trigger: [] },
    });
    return { value: writeResult(r.data), tokens: r.tokens, refreshed: r.refreshed };
  });

  const outcome = result.ok ? result.value : { ok: false as const, error: result.error };
  await ws.supabase.from("clients").update(outcome.ok
    ? { crm_id: outcome.id, crm_sync_status: "synced", crm_synced_at: new Date().toISOString(), crm_error: null }
    : { crm_sync_status: "failed", crm_error: outcome.error.slice(0, 300) },
  ).eq("id", client.id).eq("org_id", ws.org.id);
  await audit(ws, "client.crm_synced", { type: "client", id: client.id }, { ok: outcome.ok, module: biginModule });
  revalidatePath(`/clients/${client.id}`);
}

const IMPORT_LIMIT = 1000;

export async function importBiginContacts(): Promise<void> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) redirect("/clients?import=forbidden");
  const fields = "First_Name,Last_Name,Email,Mobile,Phone,Mailing_Street";

  const result = await withBigin(ws, async (c) => {
    let tokens = c.tokens;
    let refreshed = false;
    const contacts: BiginContact[] = [];
    for (let page = 1; page <= IMPORT_LIMIT / 200; page++) {
      const r = await bigin<{ data?: BiginContact[]; info?: { more_records?: boolean } }>(
        { tokens, apiDomain: c.apiDomain }, `Contacts?fields=${fields}&per_page=200&page=${page}`);
      tokens = r.tokens; refreshed ||= r.refreshed;
      contacts.push(...(r.data.data ?? []));
      if (!r.data.info?.more_records) break;
    }
    return { value: contacts, tokens, refreshed };
  });
  if (!result.ok) redirect(`/clients?import=failed`);

  const { data: existing } = await ws.supabase.from("clients").select("crm_id").eq("org_id", ws.org.id).not("crm_id", "is", null);
  const known = new Set((existing ?? []).map((r) => r.crm_id as string));
  const now = new Date().toISOString();
  const rows = result.value.filter((c) => c.id && !known.has(c.id)).map((c) => ({
    ...fromBiginContact(c), org_id: ws.org.id, created_by: ws.user.id,
    crm_sync_status: "synced", crm_synced_at: now,
  }));
  let imported = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { error, count } = await ws.supabase.from("clients").insert(rows.slice(i, i + 100), { count: "exact" });
    if (!error) imported += count ?? 0;
  }
  await audit(ws, "clients.imported_from_crm", undefined, { imported, seen: result.value.length });
  revalidatePath("/clients");
  redirect(`/clients?import=done&n=${imported}`);
}

export async function disconnectBigin() {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) redirect("/settings?integration=forbidden#integrations");
  const conn = await biginConnection(ws);
  if (conn) await revoke(conn.tokens);
  await deleteConnection(ws.supabase, ws.org.id, "zoho_bigin");
  await audit(ws, "integration.disconnected", undefined, { provider: "zoho_bigin" });
  revalidatePath("/settings");
  redirect("/settings?integration=disconnected#integrations");
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

export async function connectNotion(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can connect integrations." };
  if (!hasEncryptionKey()) return { error: "Integrations are not enabled on this server yet (encryption key missing)." };
  const token = String(data.get("token") ?? "").trim();
  if (!looksLikeNotionToken(token)) return { error: "That does not look like a Notion integration secret (it starts with ntn_)." };
  let workspace: string;
  try {
    workspace = await whoAmI(token);
  } catch {
    return { error: "Notion rejected this secret. Copy it again from the integration's Configuration tab." };
  }
  const ok = await saveConnection<NotionTokens>(ws.supabase, ws.org.id, "notion", { token }, workspace, null);
  if (!ok) return { error: "Could not save the connection." };
  await audit(ws, "integration.connected", undefined, { provider: "notion" });
  revalidatePath("/settings");
  return { ok: `Connected to ${workspace}. Share pages with the integration in Notion (••• → Connections) so LexOS can read them.` };
}

export async function disconnectNotion() {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) redirect("/settings?integration=forbidden#integrations");
  await deleteConnection(ws.supabase, ws.org.id, "notion");
  await audit(ws, "integration.disconnected", undefined, { provider: "notion" });
  revalidatePath("/settings");
  redirect("/settings?integration=disconnected#integrations");
}

/** Attach a Notion page to a matter after confirming the integration can read it. */
export async function attachNotionPage(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const p = z.object({ matterId: z.string().uuid(), page: z.string().trim().min(1).max(500) })
    .safeParse({ matterId: data.get("matterId"), page: data.get("page") });
  if (!p.success) return { error: "Paste a Notion page link." };
  const pageId = /^[0-9a-f-]{32,36}$/i.test(p.data.page) ? p.data.page : notionPageId(p.data.page);
  if (!pageId) return { error: "That is not a Notion page link." };
  const { data: matter } = await ws.supabase.from("matters").select("id").eq("id", p.data.matterId).eq("org_id", ws.org.id).maybeSingle();
  if (!matter) return { error: "Matter not found." };
  const conn = await loadConnection<NotionTokens>(ws.supabase, ws.org.id, "notion");
  if (!conn) return { error: "Notion is not connected. An admin can connect it in Settings → Integrations." };
  let page;
  try {
    page = await getPage(conn.tokens.token, pageId);
  } catch (err) {
    return { error: err instanceof NotionError && err.message.includes("404")
      ? "LexOS cannot see this page. In Notion, open the page → ••• → Connections → add your LexOS integration."
      : "Notion did not respond. Try again." };
  }
  const { data: row, error } = await ws.supabase.from("documents").insert({
    org_id: ws.org.id, matter_id: matter.id, title: page.title.slice(0, 300),
    source: "link", url: page.url, created_by: ws.user.id,
  }).select("id").single();
  if (error || !row) return { error: "Could not attach the page." };
  await audit(ws, "document.linked", { type: "document", id: row.id }, { provider: "notion" });
  revalidatePath(`/matters/${matter.id}`);
  return { ok: `Attached “${page.title}”. Assistants can now read it.` };
}
