import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, EmptyState, Field, Input, Notice, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { hireAssistant } from "@/lib/actions/assistants";
import { CATALOG, catalogAgent, CUSTOM_AGENT_KEY } from "@/lib/agents/catalog";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { canHire, monthStart } from "@/lib/entitlements";
import { integrationStatus } from "@/lib/env";
import { planState } from "@/lib/plans";
import type { AgentHire } from "@/lib/types";

export const metadata = { title: "AI Team" };

export default async function AssistantsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const ws = await requireWorkspace();
  const isAdmin = hasRole(ws, ADMIN_ROLES);
  const state = planState(ws.org);
  const [{ data: hiresData }, { count: runs }] = await Promise.all([
    ws.supabase.from("agent_hires").select("*").eq("org_id", ws.org.id).order("hired_at"),
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true })
      .eq("org_id", ws.org.id).gte("created_at", monthStart().toISOString()),
  ]);
  const hires = (hiresData ?? []) as AgentHire[];
  const hiredKeys = new Set(hires.map((h) => h.agent_key));
  const catalogHired = hires.filter((h) => h.agent_key !== CUSTOM_AGENT_KEY).length;
  const customHired = hires.length - catalogHired;
  const ai = integrationStatus().ai;
  const customDecision = canHire(state, hires, CUSTOM_AGENT_KEY);

  return (
    <>
      <PageHeader
        title="AI Team"
        description="Hire AI legal assistants for your firm. Each one works on your matters and documents, and every output is a draft for a lawyer to review."
      />
      {welcome && <div className="mb-4"><Notice tone="ok">Your firm is ready. Start by hiring your first assistants below.</Notice></div>}
      {!ai && <div className="mb-4"><Notice tone="warn">The AI service is not configured yet, so assistants cannot run. An administrator must add the OpenAI key (see Settings → Integrations).</Notice></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Package</p>
          <p className="mt-1 font-medium">{state.active ? state.plan.name : "Inactive"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Assistants hired</p>
          <p className="mt-1 font-medium">
            {catalogHired} / {state.active ? state.plan.maxCatalogAssistants : 0}
            {state.active && state.plan.maxCustomAssistants > 0 && <span className="text-sm text-muted"> · custom {customHired} / {state.plan.maxCustomAssistants}</span>}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Tasks this month</p>
          <p className="mt-1 font-medium">{runs ?? 0} / {state.active ? state.plan.monthlyAssistantRuns.toLocaleString() : 0}</p>
        </Card>
      </div>

      <SectionTitle>Your team</SectionTitle>
      {hires.length === 0 ? (
        <EmptyState title="No assistants hired yet">Hire from the catalogue below. They become available to everyone in your firm.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hires.map((h) => {
            const def = catalogAgent(h.agent_key);
            return (
              <Link key={h.id} href={`/assistants/${h.id}`} className="block">
                <Card className="h-full p-4 transition-colors hover:border-accent/50">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{h.name}</p>
                    {h.status === "paused" ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Active</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">{def?.title ?? "Custom assistant"}</p>
                  <p className="mt-3 text-sm text-accent">Give a task →</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <SectionTitle>Catalogue</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {CATALOG.map((a) => {
          const decision = canHire(state, hires, a.key);
          const hired = hiredKeys.has(a.key);
          return (
            <Card key={a.key} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-sm text-muted">{a.title}</p>
                </div>
                <Badge tone={a.tier === "pro" ? "gold" : "accent"}>{a.tier === "pro" ? "Pro" : "Basic"}</Badge>
              </div>
              <p className="mt-3 text-sm">{a.summary}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {a.skills.map((s) => <li key={s} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">{s}</li>)}
              </ul>
              <div className="mt-4 border-t border-line pt-4">
                {hired ? (
                  <p className="text-sm text-ok">On your team</p>
                ) : !isAdmin ? (
                  <p className="text-sm text-muted">Ask an owner or admin to hire this assistant.</p>
                ) : decision.ok ? (
                  <ActionForm action={hireAssistant}>
                    <input type="hidden" name="agent_key" value={a.key} />
                    <SubmitButton pendingLabel="Hiring…">Hire {a.name}</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">{decision.reason}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>Custom assistant <Badge tone="gold">Pro</Badge></SectionTitle>
      <Card className="p-5">
        {!isAdmin ? (
          <p className="text-sm text-muted">Owners and admins can create custom assistants.</p>
        ) : customDecision.ok ? (
          <ActionForm action={hireAssistant} className="space-y-4">
            <input type="hidden" name="agent_key" value={CUSTOM_AGENT_KEY} />
            <Field label="Name"><Input name="name" placeholder="e.g. Real Estate Transactions Associate" maxLength={80} required /></Field>
            <Field label="Role description" hint="What it does, for whom, in what style, and what it must always include. The safety rules always apply.">
              <Textarea name="instructions" rows={5} maxLength={4000} required
                placeholder="You prepare first drafts of sale and purchase agreements and title transfer checklists for off-plan and ready properties in Dubai, following the firm's templates…" />
            </Field>
            <SubmitButton pendingLabel="Creating…">Create custom assistant</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{customDecision.reason}</p>
        )}
      </Card>
    </>
  );
}
