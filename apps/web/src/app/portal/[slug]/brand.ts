import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PortalBrand {
  slug: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  brand_primary: string | null;
  brand_accent: string | null;
  theme: "light" | "dark" | "auto";
  portal_welcome: string | null;
}

export async function portalBrand(supabase: SupabaseClient, slug: string): Promise<PortalBrand | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug)) return null;
  const { data } = await supabase.rpc("portal_brand", { p_slug: slug });
  return ((data as PortalBrand[] | null) ?? [])[0] ?? null;
}

export interface PortalOverview {
  authorized: boolean;
  org_id?: string;
  clients?: { id: string; name: string }[];
  matters?: { id: string; number: number; title: string; status: string; matter_type: string | null; opened_on: string; client_id: string }[];
  documents?: { id: string; title: string; matter_id: string; source: "upload" | "link"; url: string | null; mime_type: string | null; created_at: string }[];
  messages?: { id: string; sender: "client" | "firm"; body: string; matter_id: string | null; created_at: string }[];
}
