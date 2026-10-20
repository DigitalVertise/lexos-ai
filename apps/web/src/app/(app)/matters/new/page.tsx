import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { MatterFields } from "@/components/matter-fields";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { createMatter } from "@/lib/actions/matters";
import { requireWorkspace } from "@/lib/auth";

export const metadata = { title: "New matter" };

export default async function NewMatterPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const ws = await requireWorkspace();
  const [{ data: clients }, { data: members }] = await Promise.all([
    ws.supabase.from("clients").select("id, name").eq("org_id", ws.org.id).order("name").limit(500),
    ws.supabase.from("memberships").select("user_id, full_name, email").eq("org_id", ws.org.id),
  ]);
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/matters" className="text-muted hover:text-ink">← Matters</Link></p>
      <PageHeader title="New matter" />
      {(clients ?? []).length === 0 ? (
        <EmptyState title="Add a client first" action={<ButtonLink href="/clients/new?next=matter">Add client</ButtonLink>}>
          Every matter belongs to a client.
        </EmptyState>
      ) : (
        <Card className="max-w-2xl p-5">
          <ActionForm action={createMatter} className="space-y-5">
            <MatterFields clients={clients ?? []} members={members ?? []} defaultClientId={client} defaultJurisdiction={ws.org.default_jurisdiction} />
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Open matter</SubmitButton>
              <Link href="/clients/new?next=matter" className="text-sm text-accent">New client instead</Link>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
