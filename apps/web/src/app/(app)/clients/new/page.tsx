import Link from "next/link";
import { ClientFields } from "@/components/client-fields";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/actions/clients";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/clients" className="text-muted hover:text-ink">← Clients</Link></p>
      <PageHeader title="New client" />
      <Card className="max-w-2xl p-5">
        <ActionForm action={createClient} className="space-y-5">
          <input type="hidden" name="next" value={next === "matter" ? "matter" : ""} />
          <ClientFields />
          <SubmitButton>{next === "matter" ? "Save and open matter" : "Save client"}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
