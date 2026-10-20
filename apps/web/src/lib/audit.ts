import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type AuditContext = { supabase: SupabaseClient; user: Pick<User, "id">; org: { id: string } };

/**
 * Append an audit event. Metadata must never contain document contents,
 * prompts or tokens — only identifiers and short labels.
 */
export async function audit(
  ws: AuditContext,
  action: string,
  entity?: { type: string; id: string },
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  const { error } = await ws.supabase.from("audit_events").insert({
    org_id: ws.org.id,
    actor_id: ws.user.id,
    action,
    entity_type: entity?.type ?? null,
    entity_id: entity?.id ?? null,
    metadata,
  });
  if (error) console.error("audit insert failed", { action, code: error.code });
}
