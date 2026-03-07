import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
  password: z.string().min(6),
});

type InviteRow = {
  token: string;
  company_id: string;
  employee_id: string;
  email: string;
  role: string;
  used_at: string | null;
  expires_at: string | null;
};

const normalizeRole = (value: unknown): "admin" | "pm" | "foreman" | "mechanic" | "operator" => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("admin") || raw.includes("executive") || raw.includes("ceo")) return "admin";
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  return "operator";
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 422 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const token = parsed.data.token.trim();

  const inviteResult = await admin
    .from("invite_tokens")
    .select("token, company_id, employee_id, email, role, used_at, expires_at")
    .eq("token", token)
    .maybeSingle<InviteRow>();
  if (inviteResult.error) {
    return NextResponse.json({ error: inviteResult.error.message }, { status: 400 });
  }
  if (!inviteResult.data) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }
  if (inviteResult.data.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }
  if (inviteResult.data.expires_at && new Date(inviteResult.data.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }
  if (inviteResult.data.email.trim().toLowerCase() !== email) {
    return NextResponse.json({ error: "Invite email does not match" }, { status: 403 });
  }

  let userId: string | null = null;
  const createUser = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
  });

  if (createUser.error) {
    const listUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listUsers.error) {
      return NextResponse.json({ error: createUser.error.message }, { status: 400 });
    }
    const existing = (listUsers.data.users ?? []).find(
      (user) => String(user.email ?? "").trim().toLowerCase() === email
    );
    if (!existing) {
      return NextResponse.json({ error: createUser.error.message }, { status: 400 });
    }
    userId = existing.id;
  } else {
    userId = createUser.data.user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Failed to resolve invite user" }, { status: 500 });
  }

  const role = normalizeRole(inviteResult.data.role);

  const membershipInsert = await admin.from("memberships").insert({
    company_id: inviteResult.data.company_id,
    user_id: userId,
    role,
  });
  if (membershipInsert.error && !/duplicate key|unique/i.test(membershipInsert.error.message || "")) {
    return NextResponse.json({ error: membershipInsert.error.message }, { status: 400 });
  }

  let employeeUpdate = await admin
    .from("employees")
    .update({ user_id: userId, role })
    .eq("company_id", inviteResult.data.company_id)
    .eq("id", inviteResult.data.employee_id);
  if (employeeUpdate.error && /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")) {
    employeeUpdate = await admin
      .from("employees")
      .update({ role })
      .eq("company_id", inviteResult.data.company_id)
      .eq("id", inviteResult.data.employee_id);
  }
  if (employeeUpdate.error) {
    return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
  }

  const tokenUse = await admin
    .from("invite_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);
  if (tokenUse.error) {
    return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
  }

  return NextResponse.json({ item: { success: true, userId } });
}
