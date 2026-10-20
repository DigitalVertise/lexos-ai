import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { open, seal } from "../crypto";

export type Provider = "zoho_bigin" | "notion" | "heygen" | "elevenlabs" | "did" | "simli" | "livetalking";

export interface ConnectionSummary {
  provider: Provider;
  status: "connected" | "error" | "revoked";
  account_label: string | null;
  connected_at: string;
  last_error: string | null;
}

const aad = (orgId: string, provider: Provider) => `${orgId}:${provider}`;

/** Connections of the firm (no secrets). */
export async function listConnections(db: SupabaseClient, orgId: string): Promise<ConnectionSummary[]> {
  const { data } = await db.rpc("integration_list", { p_org: orgId });
  return (data ?? []) as ConnectionSummary[];
}

export async function saveConnection<T>(db: SupabaseClient, orgId: string, provider: Provider,
  tokens: T, label: string | null, apiDomain: string | null): Promise<boolean> {
  const { error } = await db.rpc("integration_save", {
    p_org: orgId, p_provider: provider, p_tokens: seal(JSON.stringify(tokens), aad(orgId, provider)),
    p_label: label, p_api_domain: apiDomain,
  });
  return !error;
}

export async function loadConnection<T>(db: SupabaseClient, orgId: string, provider: Provider):
  Promise<{ tokens: T; apiDomain: string | null } | null> {
  const { data } = await db.rpc("integration_get", { p_org: orgId, p_provider: provider });
  const row = (data as { encrypted_tokens: string; api_domain: string | null }[] | null)?.[0];
  if (!row) return null;
  try {
    return { tokens: JSON.parse(open(row.encrypted_tokens, aad(orgId, provider))) as T, apiDomain: row.api_domain };
  } catch {
    return null;
  }
}

/** Record a refreshed token set and/or an error on an existing connection. */
export async function reportConnection<T>(db: SupabaseClient, orgId: string, provider: Provider,
  status: "connected" | "error", error: string | null, tokens?: T): Promise<void> {
  await db.rpc("integration_report", {
    p_org: orgId, p_provider: provider, p_status: status, p_error: error,
    p_tokens: tokens ? seal(JSON.stringify(tokens), aad(orgId, provider)) : null,
  });
}

export async function deleteConnection(db: SupabaseClient, orgId: string, provider: Provider): Promise<boolean> {
  const { error } = await db.rpc("integration_delete", { p_org: orgId, p_provider: provider });
  return !error;
}
