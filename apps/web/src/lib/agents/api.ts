import "server-only";
import { NextResponse } from "next/server";
import { requireWorkspace, type Workspace } from "../auth";
import type { AgentHire } from "../types";

export const jsonError = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Signed-in member + an assistant hired by their firm (RLS + explicit org check). */
export async function loadHire(id: string): Promise<{ ws: Workspace; hire: AgentHire } | NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError("Assistant not found.", 404);
  const ws = await requireWorkspace();
  const { data: hire } = await ws.supabase.from("agent_hires").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<AgentHire>();
  if (!hire) return jsonError("Assistant not found.", 404);
  return { ws, hire };
}
