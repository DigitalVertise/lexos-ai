import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, PageHeader, formatDate } from "@/components/ui";
import { catalogAgent } from "@/lib/agents/catalog";
import { requireWorkspace } from "@/lib/auth";
import { matterRef, type AiOutput, type Matter } from "@/lib/types";

export const metadata = { title: "Assistant output" };

export default async function OutputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace();
  const { data: out } = await ws.supabase.from("ai_outputs").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<AiOutput>();
  if (!out) notFound();
  const matter = out.matter_id
    ? (await ws.supabase.from("matters").select("id, number, title").eq("id", out.matter_id).eq("org_id", ws.org.id)
        .maybeSingle<Pick<Matter, "id" | "number" | "title">>()).data
    : null;
  const agentName = catalogAgent(out.agent_key ?? "")?.name ?? "Custom assistant";

  return (
    <>
      <p className="mb-2 text-sm">
        {matter ? <Link href={`/matters/${matter.id}#ai`} className="text-muted hover:text-ink">← {matterRef(matter)} {matter.title}</Link>
          : <Link href="/assistants" className="text-muted hover:text-ink">← AI Team</Link>}
      </p>
      <PageHeader title={agentName} description={`${formatDate(out.created_at, true)} · ${out.model}`} actions={<CopyButton text={out.output} />} />
      <Card className="mb-4 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Request</p>
        <p className="prose-output mt-1">{out.instructions}</p>
      </Card>
      <Card className="p-5">
        <div className="mb-3"><Badge tone="warn">AI draft — verify facts and authorities before use</Badge></div>
        <div className="prose-output">{out.output}</div>
      </Card>
    </>
  );
}
