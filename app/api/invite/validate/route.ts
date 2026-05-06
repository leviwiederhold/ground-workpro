import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(20),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invite code is required" }, { status: 422 });
  }

  const token = parsed.data.token.trim();
  const admin = getSupabaseAdmin();
  const fallback = await supabaseServer();
  const client = admin ?? fallback;

  const pendingInvitation = await client
    .from("pending_invitations")
    .select("id, company_id, role, email, accepted_at, expires_at")
    .eq("invite_token", token)
    .limit(1)
    .maybeSingle();
  if (pendingInvitation.error) {
    return NextResponse.json({ error: pendingInvitation.error.message }, { status: 400 });
  }

  const legacyInvitation = !pendingInvitation.data
    ? await client
        .from("invite_tokens")
        .select("token, company_id, role, email, used_at, expires_at")
        .eq("token", token)
        .limit(1)
        .maybeSingle()
    : null;
  if (legacyInvitation?.error) {
    return NextResponse.json({ error: legacyInvitation.error.message }, { status: 400 });
  }

  const invitation = pendingInvitation.data
    ? {
        company_id: pendingInvitation.data.company_id,
        role: pendingInvitation.data.role,
        email: pendingInvitation.data.email,
        used_at: pendingInvitation.data.accepted_at,
        expires_at: pendingInvitation.data.expires_at,
      }
    : legacyInvitation?.data
      ? {
          company_id: legacyInvitation.data.company_id,
          role: legacyInvitation.data.role,
          email: legacyInvitation.data.email,
          used_at: legacyInvitation.data.used_at,
          expires_at: legacyInvitation.data.expires_at,
        }
      : null;

  if (!invitation) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }
  if (invitation.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  return NextResponse.json({
    item: {
      valid: true,
      token,
      email: invitation.email ?? "",
      role: invitation.role ?? "",
      company_id: invitation.company_id,
    },
  });
}
