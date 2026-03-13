import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { resolveDisplayName } from "@/lib/user/identity";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";

const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required.").max(160),
  display_name: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  job_title: z.string().trim().max(120).optional().or(z.literal("")),
  timezone: z.string().trim().max(120).optional().or(z.literal("")),
  avatar_url: z.string().trim().max(2_000_000).optional().or(z.literal("")),
});

const isMissingColumnError = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) &&
  /does not exist|not find/i.test(String(message || ""));

type ProfileRow = {
  full_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  job_title?: string | null;
  timezone?: string | null;
  avatar_url?: string | null;
};

function normalizeProfile(row: ProfileRow | null | undefined, fallbackEmail: string) {
  const email = fallbackEmail;
  const fullName = String(row?.full_name ?? "").trim();
  const displayName = String(row?.display_name ?? "").trim();
  return {
    full_name: fullName,
    display_name: displayName,
    email,
    phone: String(row?.phone ?? "").trim(),
    job_title: String(row?.job_title ?? "").trim(),
    timezone: String(row?.timezone ?? "").trim(),
    avatar_url: String(row?.avatar_url ?? "").trim(),
    resolved_name: resolveDisplayName({ fullName, displayName, email }),
  };
}

async function selectProfile(supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"], userId: string) {
  let result = await supabase
    .from("profiles")
    .select("full_name, display_name, phone, job_title, timezone, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error.message)) {
    result = await supabase
      .from("profiles")
      .select("full_name, display_name")
      .eq("id", userId)
      .maybeSingle();
  }
  if (result.error && /display_name|Could not find the 'display_name' column/i.test(result.error.message || "")) {
    result = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
  }
  return result;
}

export async function GET() {
  try {
    const { supabase, userId, userEmail } = await getCompanyId();
    const authUser = await supabase.auth.getUser();
    const fallbackEmail = String(authUser.data?.user?.email ?? userEmail ?? "").trim();
    const profileResult = await selectProfile(supabase, userId);
    if (profileResult.error) {
      return NextResponse.json({ error: profileResult.error.message }, { status: 400 });
    }
    return NextResponse.json({
      item: normalizeProfile(profileResult.data as ProfileRow, fallbackEmail),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, companyId, userId, userEmail } = await getCompanyId();
    const body = await request.json().catch(() => null);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const authUser = await supabase.auth.getUser();
    const fallbackEmail = String(authUser.data?.user?.email ?? userEmail ?? "").trim();

    const payload = parsed.data;
    const updatePayload = {
      id: userId,
      full_name: payload.full_name,
      display_name: payload.display_name || null,
      phone: payload.phone || null,
      job_title: payload.job_title || null,
      timezone: payload.timezone || null,
      avatar_url: payload.avatar_url || null,
    };

    let upsertResult = await supabase
      .from("profiles")
      .upsert(updatePayload, { onConflict: "id" })
      .select("full_name, display_name, phone, job_title, timezone, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    if (upsertResult.error && isMissingColumnError(upsertResult.error.message)) {
      upsertResult = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            full_name: payload.full_name,
            display_name: payload.display_name || null,
          },
          { onConflict: "id" }
        )
        .select("full_name, display_name")
        .eq("id", userId)
        .maybeSingle();
    }
    if (upsertResult.error && /display_name|Could not find the 'display_name' column/i.test(upsertResult.error.message || "")) {
      upsertResult = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            full_name: payload.full_name,
          },
          { onConflict: "id" }
        )
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
    }

    if (upsertResult.error) {
      return NextResponse.json({ error: upsertResult.error.message }, { status: 400 });
    }

    await markSetupStepCompleted({
      supabase,
      companyId,
      userId,
      key: "finish_profile",
      scope: "user",
    });

    return NextResponse.json({
      item: normalizeProfile(upsertResult.data as ProfileRow, fallbackEmail),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
