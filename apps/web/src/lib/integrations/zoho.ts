import "server-only";
import type { Client } from "../types";

/**
 * Zoho Bigin via OAuth 2.0 (server-based application).
 * Docs: https://www.bigin.com/developer/docs/apis/v2/
 *
 * Zoho is multi–data-centre: the callback tells us which accounts server the
 * user signed in on, and the token response gives the API domain. Both are
 * validated against Zoho's own domains before any token is sent to them.
 */

// Least privilege: contacts + companies, and the org name for the label.
export const ZOHO_SCOPES = "ZohoBigin.modules.contacts.ALL,ZohoBigin.modules.accounts.ALL,ZohoBigin.org.READ";
const DEFAULT_ACCOUNTS = "https://accounts.zoho.com";

export interface ZohoTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  accounts_server: string;
}

const ZOHO_TLDS = "com|eu|in|com\\.au|jp|com\\.cn|sa|ca|uk";
const ACCOUNTS_RE = new RegExp(`^https://accounts\\.zoho\\.(${ZOHO_TLDS})$`);
const API_RE = new RegExp(`^https://www\\.zohoapis\\.(${ZOHO_TLDS})$`);

export const isZohoAccountsServer = (u: string | null | undefined): u is string => !!u && ACCOUNTS_RE.test(u);
export const isZohoApiDomain = (u: string | null | undefined): u is string => !!u && API_RE.test(u);

export function zohoConfigured(): boolean {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

function creds() {
  const id = process.env.ZOHO_CLIENT_ID;
  const secret = process.env.ZOHO_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Zoho is not configured");
  return { id, secret };
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`${DEFAULT_ACCOUNTS}/oauth/v2/auth`);
  u.search = new URLSearchParams({
    scope: ZOHO_SCOPES, client_id: creds().id, response_type: "code",
    access_type: "offline", prompt: "consent", redirect_uri: redirectUri, state,
  }).toString();
  return u.toString();
}

async function tokenRequest(accountsServer: string, params: Record<string, string>) {
  if (!isZohoAccountsServer(accountsServer)) throw new Error("Unexpected Zoho accounts server");
  const res = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string; error?: string;
  };
  if (!res.ok || json.error || !json.access_token) throw new Error(`Zoho token error: ${json.error ?? res.status}`);
  return json;
}

export async function exchangeCode(code: string, accountsServer: string, redirectUri: string) {
  const { id, secret } = creds();
  const json = await tokenRequest(accountsServer, {
    grant_type: "authorization_code", client_id: id, client_secret: secret, redirect_uri: redirectUri, code,
  });
  if (!json.refresh_token) throw new Error("Zoho did not return a refresh token");
  const apiDomain = json.api_domain ?? "https://www.zohoapis.com";
  if (!isZohoApiDomain(apiDomain)) throw new Error("Unexpected Zoho API domain");
  const tokens: ZohoTokens = {
    access_token: json.access_token!, refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000, accounts_server: accountsServer,
  };
  return { tokens, apiDomain };
}

export async function refresh(tokens: ZohoTokens): Promise<ZohoTokens> {
  const { id, secret } = creds();
  const json = await tokenRequest(tokens.accounts_server, {
    grant_type: "refresh_token", client_id: id, client_secret: secret, refresh_token: tokens.refresh_token,
  });
  return { ...tokens, access_token: json.access_token!, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

export async function revoke(tokens: ZohoTokens): Promise<void> {
  if (!isZohoAccountsServer(tokens.accounts_server)) return;
  await fetch(`${tokens.accounts_server}/oauth/v2/token/revoke?${new URLSearchParams({ token: tokens.refresh_token })}`,
    { method: "POST", cache: "no-store" }).catch(() => undefined);
}

export class BiginError extends Error {}

/** One Bigin API call; refreshes the access token first when it is near expiry. */
export async function bigin<T>(
  conn: { tokens: ZohoTokens; apiDomain: string },
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ data: T; tokens: ZohoTokens; refreshed: boolean }> {
  if (!isZohoApiDomain(conn.apiDomain)) throw new BiginError("Unexpected Zoho API domain");
  let tokens = conn.tokens;
  let refreshed = false;
  if (tokens.expires_at - Date.now() < 120_000) { tokens = await refresh(tokens); refreshed = true; }
  const res = await fetch(`${conn.apiDomain}/bigin/v2/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (res.status === 204) return { data: {} as T, tokens, refreshed };
  const json = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!res.ok) throw new BiginError(`Bigin ${res.status}: ${json.code ?? ""} ${json.message ?? ""}`.trim());
  return { data: json, tokens, refreshed };
}

// ---------------------------------------------------------------------------
// Mapping between LexOS clients and Bigin records
// ---------------------------------------------------------------------------

export type BiginModule = "Contacts" | "Accounts";

export function moduleFor(client: Pick<Client, "kind">): BiginModule {
  return client.kind === "organization" ? "Accounts" : "Contacts";
}

/** Split a display name into Bigin's First/Last (Last_Name is mandatory). */
export function splitName(name: string): { First_Name?: string; Last_Name: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { Last_Name: parts[0].slice(0, 80) };
  return { First_Name: parts.slice(0, -1).join(" ").slice(0, 40), Last_Name: parts[parts.length - 1].slice(0, 80) };
}

export function toBiginRecord(client: Pick<Client, "kind" | "name" | "email" | "phone" | "address" | "notes">): Record<string, string | null> {
  if (client.kind === "organization") {
    return {
      Account_Name: client.name.slice(0, 120),
      Phone: client.phone,
      Billing_Street: client.address?.slice(0, 250) ?? null,
      Description: client.notes,
    };
  }
  return {
    ...splitName(client.name),
    Email: client.email,
    Mobile: client.phone,
    Mailing_Street: client.address?.slice(0, 250) ?? null,
    Description: client.notes,
  };
}

export interface BiginContact {
  id: string;
  First_Name?: string | null;
  Last_Name?: string | null;
  Email?: string | null;
  Mobile?: string | null;
  Phone?: string | null;
  Mailing_Street?: string | null;
}

export function fromBiginContact(c: BiginContact) {
  const name = [c.First_Name, c.Last_Name].filter(Boolean).join(" ").trim();
  const phone = (c.Mobile || c.Phone || "").trim();
  return {
    kind: "individual" as const,
    name: (name || c.Email || "Unnamed contact").slice(0, 200),
    email: c.Email?.trim().toLowerCase() || null,
    phone: /^[+\d][\d\s()-]{5,24}$/.test(phone) ? phone : null,
    address: c.Mailing_Street?.slice(0, 500) || null,
    crm_id: c.id,
  };
}

type WriteResponse = { data?: { code: string; message?: string; details?: { id?: string } }[] };

export function writeResult(res: WriteResponse): { ok: true; id: string } | { ok: false; error: string } {
  const row = res.data?.[0];
  if (row?.code === "SUCCESS" && row.details?.id) return { ok: true, id: row.details.id };
  return { ok: false, error: `${row?.code ?? "UNKNOWN"}${row?.message ? `: ${row.message}` : ""}`.slice(0, 200) };
}
