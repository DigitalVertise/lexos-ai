import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/document-upload";
import { ActionForm, SubmitButton } from "@/components/form";
import { MatterFields } from "@/components/matter-fields";
import { TaskForm } from "@/components/task-form";
import { TaskList } from "@/components/task-list";
import { Badge, ButtonLink, Card, Field, Input, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { addLink, deleteDocument, setDocumentStatus } from "@/lib/actions/documents";
import { attachNotionPage } from "@/lib/actions/integrations";
import { setDocumentShared } from "@/lib/actions/portal";
import { listConnections } from "@/lib/integrations/store";
import { updateMatter } from "@/lib/actions/matters";
import { catalogAgent } from "@/lib/agents/catalog";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { matterRef, type AgentHire, type AiOutput, type Client, type DocumentRow, type Matter, type Task } from "@/lib/types";

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const { data: matter } = await ws.supabase.from("matters").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<Matter>();
  if (!matter) notFound();

  const notionConnected = (await listConnections(ws.supabase, ws.org.id)).some((c) => c.provider === "notion" && c.status === "connected");
  const [client, tasks, docs, outputs, hires, clients, members] = await Promise.all([
    ws.supabase.from("clients").select("*").eq("id", matter.client_id).eq("org_id", ws.org.id).maybeSingle<Client>(),
    ws.supabase.from("tasks").select("*").eq("org_id", ws.org.id).eq("matter_id", matter.id).order("status").order("due_at", { nullsFirst: false }),
    ws.supabase.from("documents").select("*").eq("org_id", ws.org.id).eq("matter_id", matter.id).order("created_at", { ascending: false }),
    ws.supabase.from("ai_outputs").select("id, agent_key, instructions, created_at").eq("org_id", ws.org.id).eq("matter_id", matter.id).order("created_at", { ascending: false }).limit(30),
    ws.supabase.from("agent_hires").select("*").eq("org_id", ws.org.id).eq("status", "active").order("hired_at"),
    ws.supabase.from("clients").select("id, name").eq("org_id", ws.org.id).order("name").limit(500),
    ws.supabase.from("memberships").select("user_id, full_name, email").eq("org_id", ws.org.id),
  ]);
  const canEdit = hasRole(ws, LAWYER_ROLES);
  const team = (hires.data ?? []) as AgentHire[];
  const documents = (docs.data ?? []) as DocumentRow[];
  const ref = matterRef(matter);

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/matters" className="text-muted hover:text-ink">← Matters</Link></p>
      <PageHeader
        title={`${ref} · ${matter.title}`}
        description={<>
          {client.data ? <Link href={`/clients/${client.data.id}`} className="text-accent">{client.data.name}</Link> : "—"}
          {" · "}{matter.matter_type ?? "Type not set"} · {matter.jurisdiction ?? "Jurisdiction not set"} · opened {formatDate(matter.opened_on)}
        </>}
        actions={<Badge tone={matter.status === "open" ? "ok" : "neutral"}>{matter.status.replace("_", " ")}</Badge>}
      />

      <SectionTitle>Ask your AI team</SectionTitle>
      {team.length === 0 ? (
        <Card className="p-4 text-sm text-muted">No assistants hired yet. <Link href="/assistants" className="text-accent">Hire your AI team</Link>.</Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {team.map((h) => (
            <ButtonLink key={h.id} variant="secondary" href={`/assistants/${h.id}?matter=${matter.id}`}>{h.name}</ButtonLink>
          ))}
        </div>
      )}

      <SectionTitle>Tasks</SectionTitle>
      <TaskList tasks={(tasks.data ?? []) as Task[]} canDelete={canEdit} />
      <Card className="mt-3 p-4"><TaskForm matterId={matter.id} members={members.data ?? []} /></Card>

      <div id="documents" />
      <SectionTitle>Documents</SectionTitle>
      {documents.length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
        <Card className="divide-y divide-line">
          {documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <a href={`/api/documents/${d.id}/download`} className="font-medium text-accent" target={d.source === "link" ? "_blank" : undefined} rel="noopener noreferrer">{d.title}</a>
                <p className="text-xs text-muted">{d.source === "link" ? "Link" : `${d.mime_type?.split("/").pop()} · ${size(d.size_bytes)}`} · {formatDate(d.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <form action={setDocumentStatus} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="matterId" value={matter.id} />
                  <select name="status" defaultValue={d.status} aria-label="Document status" className="rounded-md border border-line bg-surface px-2 py-1 text-xs">
                    <option value="draft">Draft</option><option value="final">Final</option><option value="archived">Archived</option>
                  </select>
                  <button type="submit" className="text-xs text-accent">Set</button>
                </form>
                {canEdit && ws.org.portal_enabled && (
                  <form action={setDocumentShared}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="matterId" value={matter.id} />
                    <input type="hidden" name="shared" value={d.shared_with_client ? "false" : "true"} />
                    <button type="submit" className={d.shared_with_client ? "text-xs text-ok" : "text-xs text-accent"}
                      title={d.shared_with_client ? "Visible in the client portal — tap to stop sharing" : "Show this document in the client portal"}>
                      {d.shared_with_client ? "Shared with client ✓" : "Share with client"}
                    </button>
                  </form>
                )}
                {canEdit && (
                  <form action={deleteDocument}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="text-xs text-muted hover:text-bad">Delete</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card className="p-4"><p className="mb-3 text-sm font-medium">Upload a file</p><DocumentUpload matterId={matter.id} /></Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium">Link a document</p>
          <ActionForm action={addLink} resetOnSuccess className="space-y-3">
            <input type="hidden" name="matterId" value={matter.id} />
            <Field label="Title"><Input name="title" maxLength={300} required /></Field>
            <Field label="Link" hint="e.g. a Notion page or shared drive file"><Input name="url" type="url" placeholder="https://" required /></Field>
            <SubmitButton>Add link</SubmitButton>
          </ActionForm>
        </Card>
        {notionConnected && (
          <Card className="p-4 md:col-span-2">
            <p className="mb-1 text-sm font-medium">Attach a Notion page</p>
            <p className="mb-3 text-sm text-muted">Assistants read attached Notion pages as context. The page must be shared with your LexOS integration in Notion.</p>
            <ActionForm action={attachNotionPage} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <input type="hidden" name="matterId" value={matter.id} />
              <Field label="Notion page link"><Input name="page" type="url" placeholder="https://www.notion.so/…" required /></Field>
              <SubmitButton pendingLabel="Checking…">Attach</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <div id="ai" />
      <SectionTitle>AI work on this matter</SectionTitle>
      {(outputs.data ?? []).length === 0 ? <p className="text-sm text-muted">Nothing yet. Ask an assistant above.</p> : (
        <Card className="divide-y divide-line">
          {((outputs.data ?? []) as Pick<AiOutput, "id" | "agent_key" | "instructions" | "created_at">[]).map((o) => (
            <Link key={o.id} href={`/outputs/${o.id}`} className="block px-4 py-3 hover:bg-surface-2">
              <p className="text-sm font-medium">{catalogAgent(o.agent_key ?? "")?.name ?? "Custom assistant"}</p>
              <p className="line-clamp-2 text-sm text-muted">{o.instructions}</p>
              <p className="text-xs text-muted">{formatDate(o.created_at, true)}</p>
            </Link>
          ))}
        </Card>
      )}

      <SectionTitle>Matter details</SectionTitle>
      <Card className="max-w-2xl p-5">
        <ActionForm action={updateMatter} className="space-y-5">
          <input type="hidden" name="id" value={matter.id} />
          <MatterFields matter={matter} clients={clients.data ?? []} members={members.data ?? []} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
