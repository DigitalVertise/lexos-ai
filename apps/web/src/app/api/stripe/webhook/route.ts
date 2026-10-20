import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, subscriptionToUpdate } from "@/lib/billing";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Stripe webhook. The browser redirect after checkout is never trusted; plan
 * changes happen only here, after signature verification. Each event ID is
 * recorded first, so retries and duplicates are applied once.
 */
export async function POST(request: NextRequest) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !env().STRIPE_SECRET_KEY || !env().SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error: dupError } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupError) {
    if (dupError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }

  try {
    await handle(event);
  } catch (err) {
    // Let Stripe retry: forget the event so the retry is processed.
    await db.from("stripe_events").delete().eq("id", event.id);
    console.error("stripe webhook failed", { type: event.type, name: (err as Error).name });
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return;
      const sub = await stripe().subscriptions.retrieve(session.subscription as string);
      await applySubscription(sub);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Re-fetch so out-of-order deliveries still apply the latest state.
      const sub = await stripe().subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
      await applySubscription(sub);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as unknown as { subscription?: string | null }).subscription
        ?? (invoice as unknown as { parent?: { subscription_details?: { subscription?: string } } }).parent?.subscription_details?.subscription;
      if (subId) await applySubscription(await stripe().subscriptions.retrieve(subId));
      return;
    }
    default:
      return;
  }
}

async function applySubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.org_id;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (!orgId) throw new Error("subscription without org_id metadata");
  const db = supabaseAdmin();
  // The org must be the one this customer was created for.
  const { data: org } = await db.from("organizations").select("id, stripe_customer_id").eq("id", orgId).maybeSingle();
  if (!org) throw new Error("unknown org");
  if (org.stripe_customer_id && org.stripe_customer_id !== customerId) throw new Error("customer mismatch");

  const update = subscriptionToUpdate(sub);
  const { error } = await db.from("organizations").update({ ...update, stripe_customer_id: customerId }).eq("id", orgId);
  if (error) throw new Error("org update failed");
  await db.from("audit_events").insert({
    org_id: orgId, actor_id: null, action: "billing.subscription_synced",
    entity_type: "subscription", entity_id: sub.id,
    metadata: { plan: update.plan, status: update.subscription_status },
  });
}
