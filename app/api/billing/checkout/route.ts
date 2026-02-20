import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { isBillingEnabled } from "@/lib/billing/isBillingEnabled";
import { isStripeConfigured } from "@/lib/billing/isStripeConfigured";

export async function POST(request: Request) {
  void request;
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Billing not enabled" }, { status: 501 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
    }

    return NextResponse.json({ error: "Not implemented" }, { status: 501 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
