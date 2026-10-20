import "server-only";
import type { Workspace } from "../auth";
import { loadConnection, type Provider } from "../integrations/store";
import type { Credentials } from "./adapters";

export async function providerCredentials(ws: Pick<Workspace, "supabase" | "org">, provider: string): Promise<Credentials | null> {
  const conn = await loadConnection<Credentials>(ws.supabase, ws.org.id, provider as Provider);
  return conn?.tokens ?? null;
}

/** Voice ids are stored as "<edge-voice-id>" or "elevenlabs:<voice_id>" or "heygen:<voice_id>". */
export function parseVoice(v: string | null | undefined): { provider: "builtin" | "elevenlabs" | "heygen"; id: string | null } {
  if (!v) return { provider: "builtin", id: null };
  const [p, ...rest] = v.split(":");
  if (rest.length && (p === "elevenlabs" || p === "heygen")) return { provider: p, id: rest.join(":") };
  return { provider: "builtin", id: v };
}
