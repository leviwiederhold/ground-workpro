import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { resolveDisplayName } from "@/lib/user/identity";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";

const accountSettingsSchema = z.object({
  timezone: z.string().trim().max(120).optional().or(z.literal("")),
  appearance: z.enum(["system", "light", "dark"]).optional(),
  notification_preferences: z
    .object({
      email_notifications: z.boolean().optional(),
      push_notifications: z.boolean().optional(),
      message_notifications: z.boolean().optional(),
      calendar_notifications: z.boolean().optional(),
    })
    .optional(),
});

const isMissingColumnError = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) &&
  /does not exist|not find/i.test(String(message || ""));

type SettingsRow = {
  full_name?: string | null;
  display_name?: string | null;
  timezone?: string | null;
  appearance_preference?: string | null;
  notification_preferences?: Record<string, unknown> | null;
};

function normalizeNotificationPreferences(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    email_notifications: source.email_notifications !== false,
    push_notifications: source.push_notifications !== false,
    message_notifications: source.message_notifications !== false,
    calendar_notifications: source.calendar_notifications !== false,
  };
}

function normalizeSettings(row: SettingsRow | null | undefined, fallbackEmail: string) {
  const email = fallbackEmail;
  const fullName = String(row?.full_name ?? "").trim();
  const displayName = String(row?.display_name ?? "").trim();
  return {
    email,
    display_name: displayName,
    full_name: fullName,
    resolved_name: resolveDisplayName({ fullName, displayName, email }),
    timezone: String(row?.timezone ?? "").trim(),
    appearance: String(row?.appearance_preference ?? "").trim() || "system",
    notification_preferences: normalizeNotificationPreferences(row?.notification_preferences),
  };
}

async function selectSettings(supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"], userId: string) {
  let result = await supabase
    .from("profiles")
    .select("full_name, display_name, timezone, appearance_preference, notification_preferences")
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
    const settingsResult = await selectSettings(supabase, userId);
    if (settingsResult.error) {
      return NextResponse.json({ error: settingsResult.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: normalizeSettings(settingsResult.data as SettingsRow, fallbackEmail) });
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
    const parsed = accountSettingsSchema.safeParse(body);
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
      timezone: payload.timezone || null,
      appearance_preference: payload.appearance || "system",
      notification_preferences: payload.notification_preferences || {},
    };

    let upsertResult = await supabase
      .from("profiles")
      .upsert(updatePayload, { onConflict: "id" })
      .select("full_name, display_name, timezone, appearance_preference, notification_preferences")
      .eq("id", userId)
      .maybeSingle();

    if (upsertResult.error && isMissingColumnError(upsertResult.error.message)) {
      upsertResult = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
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
      key: "complete_account_settings",
      scope: "user",
    });

    return NextResponse.json({ item: normalizeSettings(upsertResult.data as SettingsRow, fallbackEmail) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
