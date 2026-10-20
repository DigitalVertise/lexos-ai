import { brandStyle, themeAttr } from "@/lib/branding";
import { appUrl } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { portalBrand } from "../brand";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/**
 * Tiny launcher card that firms embed on their own website (iframe).
 * Sign-in always happens on the full portal page in a new tab, never inside
 * the frame (safer against clickjacking and third-party-cookie limits).
 */
export default async function PortalEmbed({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await portalBrand(await supabaseServer(), slug);
  if (!brand) return <p className="p-4 text-sm">Client portal unavailable.</p>;
  const href = `${appUrl()}/portal/${brand.slug}`;
  return (
    <div data-theme={themeAttr(brand.theme)} style={brandStyle(brand)} className="flex min-h-dvh items-center justify-center bg-bg p-4 text-ink">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo_url ? <img src={brand.logo_url} alt={brand.name} className="mx-auto h-10 max-w-48 object-contain" referrerPolicy="no-referrer" />
          : <p className="font-display text-lg font-semibold">{brand.name}</p>}
        <p className="mt-3 text-sm text-muted">{brand.portal_welcome || "View your matters, documents and messages securely."}</p>
        <a href={href} target="_blank" rel="noopener" className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
          Open client portal
        </a>
      </div>
    </div>
  );
}
