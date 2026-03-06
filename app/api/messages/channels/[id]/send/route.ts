import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import {
  createFallbackMessage,
} from "@/lib/messages/fallbackStore";
import { getMyMembership } from "@/lib/messages/members";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().min(1),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function toValidationDetails(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

function isThreadIdRequired(message: string) {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("thread_id") && normalized.includes("not-null");
}

function isLegacyDirectLikeName(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("dm-") || normalized === "direct message" || normalized === "direct-message";
}

async function resolveDisplayNameForUser(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string
) {
  const profile = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();

  const profileName = String(profile.data?.full_name ?? "").trim();
  if (profileName) return profileName;

  const employee = await supabase
    .from("employees")
    .select("name, full_name")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  const employeeName = String(
    (employee.data as { name?: string; full_name?: string } | null)?.name ??
      (employee.data as { name?: string; full_name?: string } | null)?.full_name ??
      ""
  ).trim();
  if (employeeName) return employeeName;

  const email = String(profile.data?.email ?? "").trim();
  if (email.includes("@")) return email.split("@")[0];
  return "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    const parsedBody = sendMessageSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const channelId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();

    const membership = await getMyMembership(supabase, companyId, channelId, userId);
    if (membership.error) {
      return okItem(
        createFallbackMessage({ companyId, channelId, senderUserId: userId, body: parsedBody.data.body }),
        201
      );
    }

    const channelResult = await supabase
      .from("message_channels")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", channelId)
      .maybeSingle();
    if (channelResult.error) return serverError();
    if (!channelResult.data) {
      return okItem(
        createFallbackMessage({ companyId, channelId, senderUserId: userId, body: parsedBody.data.body }),
        201
      );
    }

    // Normalize legacy direct-thread labels once there is a real message send.
    const channelInfo = await supabase
      .from("message_channels")
      .select("id, name, kind, dm_user_a, dm_user_b")
      .eq("company_id", companyId)
      .eq("id", channelId)
      .maybeSingle();

    if (channelInfo.data) {
      const channelName = String(channelInfo.data.name ?? "");
      const looksDirect =
        String(channelInfo.data.kind ?? "") === "direct" || isLegacyDirectLikeName(channelName);

      if (looksDirect && isLegacyDirectLikeName(channelName)) {
        const memberRows = await supabase
          .from("message_channel_members")
          .select("user_id")
          .eq("company_id", companyId)
          .eq("channel_id", channelId);

        const otherUserId = (memberRows.data ?? [])
          .map((row) => String((row as { user_id: string }).user_id))
          .find((id) => id && id !== String(userId));

        const directUserId =
          otherUserId ||
          (channelInfo.data.dm_user_a && String(channelInfo.data.dm_user_a) !== String(userId)
            ? String(channelInfo.data.dm_user_a)
            : channelInfo.data.dm_user_b && String(channelInfo.data.dm_user_b) !== String(userId)
              ? String(channelInfo.data.dm_user_b)
              : "");

        if (directUserId) {
          const displayName = await resolveDisplayNameForUser(supabase, companyId, directUserId);
          if (displayName) {
            await supabase
              .from("message_channels")
              .update({ name: displayName })
              .eq("company_id", companyId)
              .eq("id", channelId);
          }
        }
      }
    }

    const payload = {
      company_id: companyId,
      channel_id: channelId,
      sender_user_id: userId,
      body: parsedBody.data.body,
    };

    let insertPayload: Record<string, unknown> = payload;
    let insertResult = await supabase
      .from("messages")
      .insert(insertPayload)
      .select("id, channel_id, sender_user_id, body, created_at")
      .single();

    if (insertResult.error && isThreadIdRequired(insertResult.error.message || "")) {
      insertPayload = { ...payload, thread_id: channelId };
      insertResult = await supabase
        .from("messages")
        .insert(insertPayload)
        .select("id, channel_id, sender_user_id, body, created_at")
        .single();
    }

    const { data, error } = insertResult;

    if (error || !data) {
      return okItem(
        createFallbackMessage({ companyId, channelId, senderUserId: userId, body: parsedBody.data.body }),
        201
      );
    }

    await supabase
      .from("message_channel_members")
      .update({ last_read_at: data.created_at })
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .eq("user_id", userId);

    return okItem(data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
