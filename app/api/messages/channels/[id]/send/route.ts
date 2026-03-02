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
  id: z.string().uuid(),
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

    if (!membership.data) {
      const channelResult = await supabase
        .from("message_channels")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", channelId)
        .maybeSingle();
      if (channelResult.error) return serverError();
      if (!channelResult.data) return notFound("Channel not found");
      return forbidden();
    }

    const payload = {
      company_id: companyId,
      channel_id: channelId,
      sender_user_id: userId,
      body: parsedBody.data.body,
    };

    const { data, error } = await supabase
      .from("messages")
      .insert(payload)
      .select("id, channel_id, sender_user_id, body, created_at")
      .single();

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
