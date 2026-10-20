import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Shared-document download for portal clients. Authorization is checked in the database. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const back = NextResponse.redirect(new URL(`/portal/${encodeURIComponent(slug)}`, request.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return back;
  const { data: path } = await supabase.rpc("portal_document_path", { p_slug: slug, p_document: id });
  if (!path) return new NextResponse("Not found", { status: 404 });
  // Signed with the client's own session; storage RLS (documents_portal_read) re-checks access.
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path as string, 120, { download: true });
  if (error || !data) return new NextResponse("Not available", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
