import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { currentUser } from "@/lib/auth";
import { signedUrl } from "@/lib/documents";

/**
 * Authorized download: the document row is read through RLS (members only),
 * then a 60-second signed URL is issued. Storage RLS independently enforces
 * the same rule on the object itself.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: doc } = await supabase.from("documents").select("id, org_id, source, storage_path, url").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.source === "link" && doc.url) return NextResponse.redirect(doc.url);
  if (!doc.storage_path) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = await signedUrl(supabase, doc.storage_path, 60);
  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit({ supabase, user, org: { id: doc.org_id } }, "document.downloaded", { type: "document", id: doc.id });
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
