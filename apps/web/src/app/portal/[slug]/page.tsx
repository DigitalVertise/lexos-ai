import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Card, Field, Input, Notice, Select, Textarea, formatDate } from "@/components/ui";
import { portalSignOut, requestPortalLink, sendPortalMessage } from "@/lib/actions/portal";
import { brandStyle, themeAttr } from "@/lib/branding";
import { supabaseServer } from "@/lib/supabase/server";
import { portalBrand, type PortalOverview } from "./brand";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const brand = await portalBrand(await supabaseServer(), slug);
  return { title: brand ? `${brand.name} · Client portal` : "Client portal", robots: { index: false } };
}

const STATUS: Record<string, string> = { intake: "New", open: "In progress", on_hold: "On hold", closed: "Closed" };

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const brand = await portalBrand(supabase, slug);

  if (!brand) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-xl font-semibold">Portal not available</h1>
        <p className="mt-2 text-sm text-muted">This client portal does not exist or has been switched off by the firm.</p>
      </div>
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  let overview: PortalOverview | null = null;
  if (auth.user) {
    await supabase.rpc("portal_claim");
    const { data } = await supabase.rpc("portal_overview", { p_slug: slug });
    overview = data as PortalOverview | null;
  }

  return (
    <div data-theme={themeAttr(brand.theme)} style={brandStyle(brand)} className="min-h-dvh bg-bg text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <BrandMark brand={brand} />
          {auth.user && (
            <form action={portalSignOut}>
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="text-sm text-muted hover:text-ink">Sign out</button>
            </form>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {!auth.user ? (
          <div className="mx-auto max-w-sm">
            <h1 className="font-display text-2xl font-semibold">Client portal</h1>
            <p className="mt-2 text-sm text-muted">{brand.portal_welcome || `Secure access to your matters with ${brand.name}.`}</p>
            <Card className="mt-6 p-5">
              <ActionForm action={requestPortalLink} className="space-y-4">
                <input type="hidden" name="slug" value={slug} />
                <Field label="Your email" hint="Use the email address the firm has on file for you.">
                  <Input name="email" type="email" autoComplete="email" required />
                </Field>
                <SubmitButton className="w-full" pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
              </ActionForm>
            </Card>
            <p className="mt-4 text-xs text-muted">No password needed. If you are not yet registered, contact {brand.name}.</p>
          </div>
        ) : !overview?.authorized ? (
          <Card className="mx-auto max-w-md p-6">
            <h1 className="font-medium">No access yet</h1>
            <p className="mt-2 text-sm text-muted">
              You are signed in as <b>{auth.user.email}</b>, but {brand.name} has not given this email access to the portal.
              Please contact the firm, or sign out and use the email they have on file.
            </p>
          </Card>
        ) : (
          <PortalHome slug={slug} brand={brand.name} overview={overview} />
        )}
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-muted">
        {brand.website_url ? <a className="hover:text-ink" href={brand.website_url} target="_blank" rel="noopener noreferrer">{brand.name}</a> : brand.name}
        {" · "}Secure portal powered by LexOS AI
      </footer>
    </div>
  );
}

function BrandMark({ brand }: { brand: { name: string; logo_url: string | null; website_url: string | null } }) {
  const inner = brand.logo_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={brand.logo_url} alt={brand.name} className="h-9 max-w-48 object-contain" referrerPolicy="no-referrer" />
    : <span className="font-display text-lg font-semibold">{brand.name}</span>;
  return brand.website_url
    ? <a href={brand.website_url} target="_blank" rel="noopener noreferrer" title={`${brand.name} website`}>{inner}</a>
    : inner;
}

function PortalHome({ slug, brand, overview }: { slug: string; brand: string; overview: PortalOverview }) {
  const clients = overview.clients ?? [];
  const matters = overview.matters ?? [];
  const documents = overview.documents ?? [];
  const messages = overview.messages ?? [];
  const matterName = new Map(matters.map((m) => [m.id, `M-${m.number} · ${m.title}`]));
  const client = clients[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Welcome{client ? `, ${client.name}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">Your matters with {brand}.</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Matters</h2>
        {matters.length === 0 ? <p className="text-sm text-muted">No matters yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {matters.map((m) => (
              <Card key={m.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{m.title}</p>
                  <Badge tone={m.status === "closed" ? "neutral" : "ok"}>{STATUS[m.status] ?? m.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">M-{m.number}{m.matter_type ? ` · ${m.matter_type}` : ""} · opened {formatDate(m.opened_on)}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Documents shared with you</h2>
        {documents.length === 0 ? <p className="text-sm text-muted">Nothing shared yet.</p> : (
          <Card className="divide-y divide-line">
            {documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted">{matterName.get(d.matter_id) ?? ""} · {formatDate(d.created_at)}</p>
                </div>
                {d.source === "link" && d.url
                  ? <a className="text-sm text-accent" href={d.url} target="_blank" rel="noopener noreferrer">Open</a>
                  : <a className="text-sm text-accent" href={`/portal/${slug}/documents/${d.id}`}>Download</a>}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Messages</h2>
        <Card className="p-4">
          {messages.length === 0 ? <p className="text-sm text-muted">No messages yet. Write to the firm below.</p> : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <li key={m.id} className={m.sender === "client" ? "ml-8 rounded-lg bg-surface-2 p-3" : "mr-8 rounded-lg border border-line p-3"}>
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  <p className="mt-1 text-xs text-muted">{m.sender === "client" ? "You" : brand} · {formatDate(m.created_at, true)}{m.matter_id && matterName.get(m.matter_id) ? ` · ${matterName.get(m.matter_id)}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
          {client && (
            <ActionForm action={sendPortalMessage} resetOnSuccess className="mt-4 space-y-3 border-t border-line pt-4">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="clientId" value={client.id} />
              {matters.length > 0 && (
                <Field label="About">
                  <Select name="matterId" defaultValue="">
                    <option value="">General question</option>
                    {matters.map((m) => <option key={m.id} value={m.id}>M-{m.number} · {m.title}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Message"><Textarea name="body" rows={4} maxLength={5000} required /></Field>
              <SubmitButton pendingLabel="Sending…">Send to the firm</SubmitButton>
              <Notice>Messages are read by your legal team during business hours. For urgent matters, call the firm.</Notice>
            </ActionForm>
          )}
        </Card>
      </section>
    </div>
  );
}
