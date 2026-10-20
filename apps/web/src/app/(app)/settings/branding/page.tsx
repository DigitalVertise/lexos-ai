import Link from "next/link";
import { BrandingEditor } from "@/components/branding-editor";
import { CopyButton } from "@/components/copy-button";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, Notice, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { savePortalSettings } from "@/lib/actions/branding";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/env";

export const metadata = { title: "Branding & client portal" };

function suggestSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-firm";
}

export default async function BrandingPage() {
  const ws = await requireWorkspace();
  const isAdmin = hasRole(ws, ADMIN_ROLES);
  const base = appUrl();
  const slug = ws.org.portal_slug ?? suggestSlug(ws.org.name);
  const portalUrl = `${base}/portal/${slug}`;
  const linkSnippet = `<a href="${portalUrl}" target="_blank" rel="noopener">Client portal</a>`;
  const widgetSnippet = `<script src="${base}/portal-widget.js" data-portal="${slug}" defer></script>`;
  const iframeSnippet = `<iframe src="${portalUrl}/embed" title="Client portal" style="width:100%;max-width:420px;height:260px;border:0" loading="lazy"></iframe>`;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/settings" className="text-muted hover:text-ink">← Settings</Link></p>
      <PageHeader title="Branding & client portal" description="Make LexOS and your client portal look like your firm." />
      {!isAdmin && <Notice>Only owners and admins can change branding.</Notice>}

      {isAdmin && (
        <>
          <SectionTitle>Firm branding</SectionTitle>
          <BrandingEditor
            orgId={ws.org.id}
            website={ws.org.website_url}
            logo={ws.org.logo_url}
            colors={ws.org.brand_colors ?? []}
            primary={ws.org.brand_primary}
            accent={ws.org.brand_accent}
            theme={ws.org.theme ?? "auto"}
          />

          <SectionTitle>Client portal</SectionTitle>
          <Card className="p-5">
            <p className="text-sm text-muted">
              A branded page where your clients sign in with their email (no password) to see their matters, download documents you share,
              and message the firm. Clients only ever see their own matters — this is enforced by the database.
            </p>
            <ActionForm action={savePortalSettings} className="mt-4 space-y-4">
              <Field label="Portal address" hint={`${base}/portal/…`}>
                <Input name="slug" defaultValue={slug} required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" />
              </Field>
              <Field label="Welcome message (optional)">
                <Textarea name="welcome" rows={3} maxLength={600} defaultValue={ws.org.portal_welcome ?? ""} placeholder="Welcome to our secure client portal." />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={ws.org.portal_enabled} /> Portal is live
              </label>
              <SubmitButton>Save portal</SubmitButton>
            </ActionForm>
          </Card>

          {ws.org.portal_slug && (
            <Card className="mt-3 space-y-4 p-5">
              <div>
                <p className="text-sm font-medium">Portal link</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-surface-2 px-2 py-1 text-xs">{portalUrl}</code>
                  <CopyButton text={portalUrl} />
                  {ws.org.portal_enabled && <a className="text-sm text-accent" href={`/portal/${ws.org.portal_slug}`} target="_blank" rel="noreferrer">Open</a>}
                </div>
                {!ws.org.portal_enabled && <p className="mt-1 text-xs text-warn">Switched off — visitors see “portal not available”.</p>}
              </div>
              <div>
                <p className="text-sm font-medium">Add to your website</p>
                <p className="text-xs text-muted">Pick one and paste it into your site (most website builders have an “HTML / embed code” block).</p>
                <Snippet label="Simple link" code={linkSnippet} />
                <Snippet label="Floating “Client portal” button (all pages)" code={widgetSnippet} />
                <Snippet label="Embedded card" code={iframeSnippet} />
              </div>
              <p className="text-xs text-muted">Invite clients from each client’s page → <b>Portal access</b>. Share documents from a matter’s document list.</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs"><code>{code}</code></pre>
        <CopyButton text={code} />
      </div>
    </div>
  );
}
