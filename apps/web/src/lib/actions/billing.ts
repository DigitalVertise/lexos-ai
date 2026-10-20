"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { priceFor, stripe } from "@/lib/billing";
import { appUrl, integrationStatus } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function startCheckout(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) redirect("/settings?billing=forbidden#billing");
  if (!integrationStatus().billing || !integrationStatus().serviceRole) redirect("/settings?billing=unavailable#billing");
  const plan = z.enum(["basic", "pro"]).parse(data.get("plan"));
  const price = priceFor(plan)!;

  let customerId = ws.org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe().customers.create(
      { name: ws.org.name, email: ws.user.email, metadata: { org_id: ws.org.id } },
      { idempotencyKey: `customer-${ws.org.id}` },
    );
    customerId = customer.id;
    // Billing columns are writable only by the server (service role), never by users.
    await supabaseAdmin().from("organizations").update({ stripe_customer_id: customerId }).eq("id", ws.org.id).is("stripe_customer_id", null);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: ws.org.id,
    subscription_data: { metadata: { org_id: ws.org.id } },
    metadata: { org_id: ws.org.id },
    allow_promotion_codes: true,
    success_url: `${appUrl()}/settings?billing=success#billing`,
    cancel_url: `${appUrl()}/settings?billing=cancelled#billing`,
  });
  await audit(ws, "billing.checkout_started", { type: "organization", id: ws.org.id }, { plan });
  redirect(session.url!);
}

export async function openBillingPortal() {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) redirect("/settings?billing=forbidden#billing");
  if (!integrationStatus().billing || !ws.org.stripe_customer_id) redirect("/settings?billing=unavailable#billing");
  const session = await stripe().billingPortal.sessions.create({
    customer: ws.org.stripe_customer_id!,
    return_url: `${appUrl()}/settings#billing`,
  });
  redirect(session.url);
}
