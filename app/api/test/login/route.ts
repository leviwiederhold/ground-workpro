import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function ensureDevUser(email: string, password: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const normalizedEmail = email.trim().toLowerCase();
  let userId: string | null = null;

  const existingUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingUsers.error) {
    throw new Error(existingUsers.error.message);
  }

  const existingUser = (existingUsers.data.users ?? []).find(
    (user) => String(user.email ?? "").trim().toLowerCase() === normalizedEmail
  );

  if (existingUser) {
    userId = existingUser.id;
    const updateResult = await admin.auth.admin.updateUserById(existingUser.id, {
      email_confirm: true,
      password,
    });
    if (updateResult.error) {
      throw new Error(updateResult.error.message);
    }
  } else {
    const createResult = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });
    if (createResult.error) {
      throw new Error(createResult.error.message);
    }
    userId = createResult.data.user?.id ?? null;
  }

  if (!userId) {
    throw new Error("Failed to resolve E2E auth user");
  }

  const profileUpsert = await admin.from("profiles").upsert({
    id: userId,
    full_name: normalizedEmail,
  });
  if (profileUpsert.error && !/duplicate key|unique/i.test(profileUpsert.error.message || "")) {
    throw new Error(profileUpsert.error.message);
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 422 });
  }

  const supabase = await supabaseServer();
  let { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    try {
      await ensureDevUser(parsed.data.email, parsed.data.password);
    } catch (ensureError) {
      const message = ensureError instanceof Error ? ensureError.message : "Failed to provision dev login";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const retry = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    error = retry.error;
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ item: { success: true } });
}
