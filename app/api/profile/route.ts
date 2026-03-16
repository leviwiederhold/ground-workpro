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

async function syncEmployeeProfile(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string,
  fallbackEmail: string,
  payload: z.infer<typeof profileSchema>
) {
  const employeeByUserId = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  let employeeId = String(employeeByUserId.data?.id ?? "").trim();
  if (!employeeId && fallbackEmail) {
    const employeeByEmail = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .ilike("email", fallbackEmail)
      .limit(1)
      .maybeSingle();
    if (!employeeByEmail.error && employeeByEmail.data?.id) {
      employeeId = String(employeeByEmail.data.id);
    }
  }

  if (!employeeId) return;

  const updatePayload: Record<string, unknown> = {
    user_id: userId,
    name: payload.full_name,
    full_name: payload.full_name,
    email: fallbackEmail || undefined,
    phone: payload.phone || null,
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await supabase
      .from("employees")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", employeeId);
    if (!result.error) return;

    const missingColumn =
      result.error.message?.match(/Could not find the '([^']+)' column/i)?.[1] ??
      result.error.message?.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i)?.[1] ??
      null;
    if (!missingColumn || !(missingColumn in updatePayload)) return;
    delete updatePayload[missingColumn];
  }
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
      .upsert({ ...updatePayload, email: fallbackEmail || null }, { onConflict: "id" })
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

    await syncEmployeeProfile(supabase, companyId, userId, fallbackEmail, payload);

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
