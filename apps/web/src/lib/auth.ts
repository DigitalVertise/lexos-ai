import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Membership, Organization, Role } from "@/lib/types";

export const ORG_COOKIE = "lexos_org";

export interface Workspace {
  supabase: SupabaseClient;
  user: User;
  org: Organization;
  role: Role;
  memberships: (Membership & { org_name: string })[];
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do this.") {
    super(message);
  }
}

/** The verified user (checked with Supabase Auth, not just the cookie). */
export async function currentUser(): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function requireUser() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Resolve the signed-in user's current organization.
 *
 * The org is chosen from the user's own memberships (read through RLS). The
 * org cookie is only a preference: an org the user doesn't belong to is
 * ignored, so a tampered cookie can never grant access.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const { supabase, user } = await requireUser();
  const { data: rows, error } = await supabase
    .from("memberships")
    .select("org_id, user_id, role, full_name, email, created_at, organizations(name)")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw new Error("Could not load your firms");
  const memberships = (rows ?? []).map((r) => {
    const org = r.organizations as unknown as { name: string } | null;
    return { ...(r as unknown as Membership), org_name: org?.name ?? "" };
  });
  if (memberships.length === 0) redirect("/onboarding");

  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const membership = memberships.find((m) => m.org_id === preferred) ?? memberships[0];

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, country, default_jurisdiction, plan, subscription_status, trial_ends_at, current_period_end, stripe_customer_id, created_at")
    .eq("id", membership.org_id)
    .single();
  if (orgError || !org) throw new Error("Could not load your firm");

  return { supabase, user, org: org as Organization, role: membership.role, memberships };
}

export function hasRole(ws: Pick<Workspace, "role">, roles: Role[]): boolean {
  return roles.includes(ws.role);
}

export function assertRole(ws: Pick<Workspace, "role">, roles: Role[]): void {
  if (!hasRole(ws, roles)) throw new ForbiddenError();
}

export const ADMIN_ROLES: Role[] = ["owner", "admin"];
export const LAWYER_ROLES: Role[] = ["owner", "admin", "lawyer"];
