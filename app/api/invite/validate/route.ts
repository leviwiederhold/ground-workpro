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
    .select("id, company_id, role, email, job_title, accepted_at, expires_at")
    .eq("invite_token", token)
    .limit(1)
    .maybeSingle();
  // Tolerate environments where job_title hasn't been migrated yet.
  const pendingInvitationFallback =
    pendingInvitation.error && /job_title/i.test(pendingInvitation.error.message || "")
      ? await client
          .from("pending_invitations")
          .select("id, company_id, role, email, accepted_at, expires_at")
          .eq("invite_token", token)
          .limit(1)
          .maybeSingle()
      : null;
  const pendingData = pendingInvitationFallback?.data ?? pendingInvitation.data;
  const pendingErr = pendingInvitationFallback ? pendingInvitationFallback.error : pendingInvitation.error;
  if (pendingErr) {
    return NextResponse.json({ error: pendingErr.message }, { status: 400 });
  }

  const legacyInvitation = !pendingData
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

  const invitation = pendingData
    ? {
        company_id: pendingData.company_id,
        role: pendingData.role,
        email: pendingData.email,
        job_title: (pendingData as { job_title?: string | null }).job_title ?? "",
        used_at: pendingData.accepted_at,
        expires_at: pendingData.expires_at,
      }
    : legacyInvitation?.data
      ? {
          company_id: legacyInvitation.data.company_id,
          role: legacyInvitation.data.role,
          email: legacyInvitation.data.email,
          job_title: "",
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

  // Resolve the workspace name so the acceptance screen can show what the
  // employee is joining.
  let companyName = "";
  const companyResult = await client
    .from("companies")
    .select("name")
    .eq("id", invitation.company_id)
    .maybeSingle();
  if (!companyResult.error) {
    companyName = String(companyResult.data?.name ?? "").trim();
  }

  // Detect whether the CURRENT browser session already belongs to the invited
  // company. The signup/accept screen uses this to block an owner/admin (or any
  // existing member) from accepting the invite in their own session — they must
  // use a different browser or sign out so the invitee gets their own account.
  let viewerIsMember = false;
  let viewerIsOwner = false;
  const { data: viewerAuth } = await fallback.auth.getUser();
  const viewerUserId = String(viewerAuth?.user?.id ?? "").trim();
  if (viewerUserId) {
    const viewerMembership = await client
      .from("memberships")
      .select("role")
      .eq("company_id", invitation.company_id)
      .eq("user_id", viewerUserId)
      .maybeSingle();
    if (!viewerMembership.error && viewerMembership.data) {
      viewerIsMember = true;
      const viewerRole = String(viewerMembership.data.role ?? "").trim().toLowerCase();
      viewerIsOwner =
        viewerRole.includes("admin") || viewerRole.includes("ceo") || viewerRole.includes("executive");
    }
  }

  return NextResponse.json({
    item: {
      valid: true,
      token,
      email: invitation.email ?? "",
      role: invitation.role ?? "",
      job_title: invitation.job_title ?? "",
      company_id: invitation.company_id,
      company_name: companyName,
      viewer_is_member: viewerIsMember,
      viewer_is_owner: viewerIsOwner,
    },
  });
}
