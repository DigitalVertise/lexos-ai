import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentConsole } from "@/components/agent-console";
import { AssistantRunner } from "@/components/assistant-runner";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, Card, Field, PageHeader, Select, Textarea, formatDate } from "@/components/ui";
import { releaseAssistant, updateAssistant } from "@/lib/actions/assistants";
import { catalogAgent, CUSTOM_AGENT_KEY } from "@/lib/agents/catalog";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { monthlyRuns } from "@/lib/agents/usage";
import { providerMeta } from "@/lib/avatars/providers";
import { canRun } from "@/lib/entitlements";
import { integrationStatus } from "@/lib/env";
import { planState } from "@/lib/plans";
import { matterRef, type AgentHire, type AiOutput, type DocumentRow, type Matter } from "@/lib/types";

const READABLE = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]);

export default async function AssistantPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ matter?: string }>;
}) {
  const { id } = await params;
  const { matter: matterParam } = await searchParams;
  const ws = await requireWorkspace();
  const { data: hire } = await ws.supabase.from("agent_hires").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<AgentHire>();
  if (!hire) notFound();
  const def = catalogAgent(hire.agent_key);
  const isAdmin = hasRole(ws, ADMIN_ROLES);

  const [{ data: matters }, { data: history }, monthRuns] = await Promise.all([
    ws.supabase.from("matters").select("id, number, title, status").eq("org_id", ws.org.id).neq("status", "closed").order("number", { ascending: false }).limit(200),
    ws.supabase.from("ai_outputs").select("id, matter_id, instructions, created_at").eq("org_id", ws.org.id).eq("agent_hire_id", hire.id).order("created_at", { ascending: false }).limit(15),
    monthlyRuns(ws),
  ]);
  const matterList = (matters ?? []) as Pick<Matter, "id" | "number" | "title" | "status">[];
  const selected = matterList.find((m) => m.id === matterParam) ?? null;

  let documents: { id: string; title: string; readable: boolean }[] = [];
  if (selected) {
    const { data: docs } = await ws.supabase.from("documents").select("id, title, source, mime_type")
      .eq("org_id", ws.org.id).eq("matter_id", selected.id).order("created_at", { ascending: false }).limit(50);
    documents = ((docs ?? []) as Pick<DocumentRow, "id" | "title" | "source" | "mime_type">[])
      .map((d) => ({ id: d.id, title: d.title, readable: d.source === "upload" && READABLE.has(d.mime_type ?? "") }));
  }

  const runDecision = canRun(planState(ws.org), monthRuns, 0);
  const avatarMeta = providerMeta(hire.avatar?.provider);
  const disabledReason = !integrationStatus().ai && !integrationStatus().runtime
    ? "The AI service is not configured yet. An administrator needs to add the OpenAI key."
    : hire.status === "paused" ? `${hire.name} is paused. Resume it in the settings below.`
    : runDecision.ok ? null : runDecision.reason;
  const matterNames = new Map(matterList.map((m) => [m.id, matterRef(m)]));

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/assistants" className="text-muted hover:text-ink">← AI Team</Link></p>
      <PageHeader
        title={hire.name}
        description={def?.summary ?? "Custom assistant defined by your firm."}
        actions={hire.status === "paused" ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Active</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Field label="Matter (recommended)">
                  <Select name="matter" defaultValue={selected?.id ?? ""}>
                    <option value="">No matter — general task</option>
                    {matterList.map((m) => <option key={m.id} value={m.id}>{matterRef(m)} · {m.title}</option>)}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" type="submit">Use matter</Button>
            </form>
            {selected && documents.length === 0 && (
              <p className="mt-2 text-xs text-muted">No documents on {matterRef(selected)} yet. <Link className="text-accent" href={`/matters/${selected.id}#documents`}>Upload one</Link> to let the assistant read it.</p>
            )}
          </Card>
          <AgentConsole
            hireId={hire.id}
            assistantName={hire.name}
            matter={selected ? { id: selected.id, ref: matterRef(selected) } : null}
            disabledReason={disabledReason}
            avatar={hire.avatar && avatarMeta ? {
              provider: avatarMeta.id, providerName: avatarMeta.name, kind: avatarMeta.kind,
              portraitUrl: hire.avatar.portrait_path ? `/api/agents/${hire.id}/portrait?v=${encodeURIComponent(hire.avatar.portrait_path)}` : null,
              anchor: hire.avatar.anchor ?? null, voice: hire.avatar.voice ?? null, previewImage: hire.avatar.provider_preview_url ?? null,
            } : null}
            taskRunner={
              <AssistantRunner
                key={selected?.id ?? "none"}
                hireId={hire.id}
                assistantName={hire.name}
                examplePrompt={def?.examplePrompt ?? "Describe the task…"}
                matter={selected ? { id: selected.id, ref: matterRef(selected), title: selected.title } : null}
                documents={documents}
                disabledReason={disabledReason}
              />
            }
          />
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <p className="text-sm font-medium">Avatar & voice</p>
            <p className="mt-1 text-sm text-muted">{avatarMeta ? avatarMeta.name : "Not set up yet"}</p>
            <Link className="mt-1 inline-block text-sm text-accent" href={`/studio/${hire.id}`}>Open Avatar studio →</Link>
          </Card>
          {def && (
            <Card className="p-4">
              <p className="text-sm font-medium">Skills</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">{def.skills.map((s) => <li key={s}>• {s}</li>)}</ul>
            </Card>
          )}
          <Card className="p-4">
            <p className="text-sm font-medium">Recent work</p>
            {(history ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">No tasks yet.</p> : (
              <ul className="mt-2 space-y-2">
                {((history ?? []) as Pick<AiOutput, "id" | "matter_id" | "instructions" | "created_at">[]).map((h) => (
                  <li key={h.id}>
                    <Link href={`/outputs/${h.id}`} className="block text-sm hover:text-accent">
                      <span className="line-clamp-2">{h.instructions}</span>
                      <span className="text-xs text-muted">{formatDate(h.created_at, true)}{h.matter_id && matterNames.get(h.matter_id) ? ` · ${matterNames.get(h.matter_id)}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {isAdmin && (
            <Card className="p-4">
              <p className="text-sm font-medium">Settings</p>
              <ActionForm action={updateAssistant} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={hire.id} />
                <Field label={hire.agent_key === CUSTOM_AGENT_KEY ? "Role description" : "Firm instructions"}
                  hint={hire.agent_key === CUSTOM_AGENT_KEY ? undefined : "House style, preferred language, templates to follow."}>
                  <Textarea name="instructions" rows={5} maxLength={4000} defaultValue={hire.instructions ?? ""} />
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={hire.status}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </Select>
                </Field>
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
              <form action={releaseAssistant} className="mt-4 border-t border-line pt-3">
                <input type="hidden" name="id" value={hire.id} />
                <Button variant="danger" type="submit">Let go of {hire.name}</Button>
                <p className="mt-1 text-xs text-muted">Frees the slot in your package. Past work stays on your matters.</p>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
