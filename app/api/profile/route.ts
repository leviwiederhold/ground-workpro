import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  normalizePhoneForStorage,
  normalizeTimezoneOption,
  sanitizeProfileFullName,
} from "@/lib/user/profileFields";
import { resolveDisplayName } from "@/lib/user/identity";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";
import { selectProfileColumns, upsertProfileColumns, type ProfileRecord } from "@/lib/user/profileRecord";

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

function getDecodedDataUrlSize(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Full name is required.").max(160),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  job_title: z.string().trim().max(120).optional().or(z.literal("")),
  timezone: z.string().trim().max(120).optional().or(z.literal("")),
  avatar_url: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .superRefine((value, ctx) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) return;
      const decodedSize = getDecodedDataUrlSize(normalized);
      if (decodedSize !== null && decodedSize > MAX_AVATAR_SIZE_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Avatar file must be 2MB or smaller.",
        });
        return;
      }
      if (decodedSize === null && normalized.length > 2_000_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Avatar value is too large.",
        });
      }
    }),
});

function normalizeProfile(row: ProfileRecord | null | undefined, fallbackEmail: string) {
  const email = fallbackEmail;
  const fullName = sanitizeProfileFullName(row?.full_name, email);
  return {
    full_name: fullName,
    display_name: "",
    email,
    phone: String(row?.phone ?? "").trim(),
    job_title: String(row?.job_title ?? "").trim(),
    timezone: String(row?.timezone ?? "").trim(),
    avatar_url: String(row?.avatar_url ?? "").trim(),
    resolved_name: resolveDisplayName({ fullName, email }),
  };
}

async function syncEmployeeProfile(
  supabase: Awaited<ReturnType<typeof getOptionalCompanyId>>["supabase"],
  companyId: string | null,
  userId: string,
  fallbackEmail: string,
  payload: z.infer<typeof profileSchema>
) {
  if (!companyId) return;
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
    const { supabase, userId, userEmail } = await getOptionalCompanyId();
    const authUser = await supabase.auth.getUser();
    const fallbackEmail = String(authUser.data?.user?.email ?? userEmail ?? "").trim();
    const profileResult = await selectProfileColumns(supabase, userId, ["full_name", "phone", "job_title", "timezone", "avatar_url"]);
    if (profileResult.error) {
      return NextResponse.json({ error: profileResult.error.message }, { status: 400 });
    }
    return NextResponse.json({
      item: normalizeProfile(profileResult.data as ProfileRecord, fallbackEmail),
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
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
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

    const payload = {
      ...parsed.data,
      full_name: sanitizeProfileFullName(parsed.data.full_name, fallbackEmail),
      phone: normalizePhoneForStorage(parsed.data.phone),
      timezone: normalizeTimezoneOption(parsed.data.timezone),
      avatar_url: String(parsed.data.avatar_url ?? "").trim(),
    };
    const upsertPayload: Record<string, unknown> = {
      id: userId,
      full_name: payload.full_name,
      phone: payload.phone || null,
      job_title: payload.job_title || null,
      timezone: payload.timezone || null,
      avatar_url: payload.avatar_url || null,
    };
    const upsertResult = await upsertProfileColumns({
      supabase,
      userId,
      payload: upsertPayload,
      selectColumns: ["full_name", "phone", "job_title", "timezone", "avatar_url"],
    });
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
      item: {
        ...normalizeProfile(upsertResult.data as ProfileRecord, fallbackEmail),
        phone: payload.phone,
        job_title: payload.job_title || String((upsertResult.data as ProfileRecord)?.job_title ?? "").trim(),
        timezone: payload.timezone,
        avatar_url:
          Object.prototype.hasOwnProperty.call(upsertResult.data ?? {}, "avatar_url")
            ? String((upsertResult.data as ProfileRecord)?.avatar_url ?? "").trim()
            : payload.avatar_url,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
