import Link from "next/link";
import { notFound } from "next/navigation";
import { AvatarStudio, type Library } from "@/components/avatar-studio";
import { Notice, PageHeader } from "@/components/ui";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { adapterFor } from "@/lib/avatars/adapters";
import { providerCredentials } from "@/lib/avatars/credentials";
import { BUILTIN_VOICES, PROVIDERS } from "@/lib/avatars/providers";
import { integrationStatus } from "@/lib/env";
import { listConnections } from "@/lib/integrations/store";
import type { AgentHire } from "@/lib/types";

export const metadata = { title: "Avatar studio" };

export default async function StudioHirePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const { data: hire } = await ws.supabase.from("agent_hires").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<AgentHire>();
  if (!hire) notFound();
  const isAdmin = hasRole(ws, ADMIN_ROLES);
  const connections = await listConnections(ws.supabase, ws.org.id);
  const connected = connections.filter((c) => c.status === "connected").map((c) => c.provider as string);
  const runtime = integrationStatus().runtime;

  // Real provider libraries (only for connected providers; errors are shown, never faked).
  const libraries: Library[] = [];
  for (const pid of ["heygen", "elevenlabs"] as const) {
    if (!connected.includes(pid)) continue;
    const adapter = adapterFor(pid)!;
    const creds = await providerCredentials(ws, pid);
    if (!creds) continue;
    const lib: Library = { provider: pid, avatars: [], voices: [], error: null };
    try {
      if (adapter.listAvatars) lib.avatars = await adapter.listAvatars(creds);
      if (adapter.listVoices) lib.voices = await adapter.listVoices(creds);
    } catch (err) {
      lib.error = (err as Error).message.slice(0, 200);
    }
    libraries.push(lib);
  }

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/studio" className="text-muted hover:text-ink">← Avatar studio</Link></p>
      <PageHeader title={`${hire.name} — avatar`} description="Portrait, lip anchor, provider and voice. Previews are labelled demo or live." />
      {!isAdmin && <div className="mb-4"><Notice>Only owners and admins can change avatars. You can still preview.</Notice></div>}
      <AvatarStudio
        hireId={hire.id}
        hireName={hire.name}
        orgId={ws.org.id}
        canEdit={isAdmin}
        avatar={hire.avatar}
        portraitUrl={hire.avatar?.portrait_path ? `/api/agents/${hire.id}/portrait?v=${encodeURIComponent(hire.avatar.portrait_path)}` : null}
        providers={PROVIDERS.map((p) => ({
          id: p.id, name: p.name, kind: p.kind, usesPortrait: p.usesPortrait,
          available: p.credentials.length === 0 ? (p.id !== "leaptalk" || runtime) : connected.includes(p.id),
        }))}
        builtinVoices={BUILTIN_VOICES}
        libraries={libraries}
        runtime={runtime}
      />
    </>
  );
}
