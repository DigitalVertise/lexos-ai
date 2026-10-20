import "server-only";
import type { Workspace } from "../auth";
import { monthStart } from "../entitlements";

/** Firm-wide assistant usage this month: one-off tasks + chat/voice/avatar replies. */
export async function monthlyRuns(ws: Pick<Workspace, "supabase" | "org">): Promise<number> {
  const since = monthStart().toISOString();
  const [{ count: tasks }, chats] = await Promise.all([
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).gte("created_at", since),
    ws.supabase.rpc("chat_replies_since", { p_org: ws.org.id, p_since: since }),
  ]);
  return (tasks ?? 0) + (typeof chats.data === "number" ? chats.data : 0);
}

/** This user's requests in the last minute (rate limit). */
export async function userRunsLastMinute(ws: Pick<Workspace, "supabase" | "org" | "user">): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const [{ count: a }, { count: b }] = await Promise.all([
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("created_by", ws.user.id).gte("created_at", since),
    ws.supabase.from("agent_messages").select("id", { count: "exact", head: true })
      .eq("org_id", ws.org.id).eq("created_by", ws.user.id).eq("role", "assistant").gte("created_at", since),
  ]);
  return (a ?? 0) + (b ?? 0);
}
