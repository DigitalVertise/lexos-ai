import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, Card, EmptyState, Field, Input, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { connectAvatarProvider, disconnectAvatarProvider } from "@/lib/actions/avatar";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { PROVIDERS, providerMeta } from "@/lib/avatars/providers";
import { integrationStatus } from "@/lib/env";
import { listConnections } from "@/lib/integrations/store";
import type { AgentHire } from "@/lib/types";

export const metadata = { title: "Avatar studio" };

export default async function StudioPage() {
  const ws = await requireWorkspace();
  const isAdmin = hasRole(ws, ADMIN_ROLES);
  const [{ data: hires, error }, connections] = await Promise.all([
    ws.supabase.from("agent_hires").select("*").eq("org_id", ws.org.id).order("hired_at"),
    listConnections(ws.supabase, ws.org.id),
  ]);
  const connected = new Map(connections.map((c) => [c.provider as string, c]));
  const runtime = integrationStatus().runtime;
  const migrated = !error || error.code !== "42703";

  return (
    <>
      <PageHeader title="Avatar studio" description="Give each AI assistant a face and a voice: portrait, lip anchor, provider and voice." />
      {!migrated && <div className="mb-4"><Notice tone="warn">Avatars need database update 0006. Ask Digital Vertise or run it from Settings.</Notice></div>}

      <SectionTitle>Assistants</SectionTitle>
      {(hires ?? []).length === 0 ? (
        <EmptyState title="No assistants hired yet" action={<Link className="text-accent" href="/assistants">Hire from the AI Team</Link>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {((hires ?? []) as AgentHire[]).map((h) => {
            const meta = providerMeta(h.avatar?.provider);
            return (
              <Link key={h.id} href={`/studio/${h.id}`} className="block">
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  {h.avatar?.portrait_path
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/agents/${h.id}/portrait`} alt="" className="h-14 w-14 rounded-full object-cover" />
                    : h.avatar?.provider_preview_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={h.avatar.provider_preview_url} alt="" className="h-14 w-14 rounded-full object-cover" referrerPolicy="no-referrer" />
                      : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-muted">{h.name.slice(0, 1)}</span>}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{h.name}</p>
                    <p className="truncate text-xs text-muted">{meta ? meta.name : "No avatar yet"}</p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <SectionTitle>Providers</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        The built-in portrait needs nothing. Open-source and premium providers are optional; keys are encrypted and only used from the server.
        {!runtime && " The LexOS agent runtime (free voices, AI portraits, LeapTalk) is not connected yet — devices use their built-in voice meanwhile."}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const conn = connected.get(p.id);
          const needsRuntime = p.id === "leaptalk";
          const ready = p.credentials.length === 0 ? (!needsRuntime || runtime) : Boolean(conn);
          return (
            <Card key={p.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{p.kind === "live-local" ? "In-browser" : p.kind === "video" ? "Video per reply" : p.kind === "realtime" ? "Real-time WebRTC" : "Voice"} · {p.free ? "free" : "paid account"}{p.maturity === "beta" ? " · beta" : ""}</p>
                </div>
                <Badge tone={ready ? "ok" : "neutral"}>{ready ? (conn ? "Connected" : "Ready") : p.credentials.length ? "Not connected" : "Needs runtime"}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{p.summary}</p>
              {conn?.account_label && <p className="mt-1 text-xs text-muted">{conn.account_label}</p>}
              {isAdmin && p.credentials.length > 0 && (conn ? (
                <form action={disconnectAvatarProvider} className="mt-3">
                  <input type="hidden" name="provider" value={p.id} />
                  <Button variant="secondary" type="submit">Disconnect</Button>
                </form>
              ) : (
                <ActionForm action={connectAvatarProvider} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <input type="hidden" name="provider" value={p.id} />
                  {p.credentials.includes("apiKey") && <Field label="API key"><Input name="apiKey" type="password" autoComplete="off" required /></Field>}
                  {p.credentials.includes("url") && <Field label="Server address"><Input name="url" type="url" placeholder="https://avatar.yourfirm.com" required /></Field>}
                  <SubmitButton pendingLabel="Checking…">Connect</SubmitButton>
                </ActionForm>
              ))}
              {p.docs && <a className="mt-2 inline-block text-xs text-accent" href={p.docs} target="_blank" rel="noreferrer">Provider docs</a>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
