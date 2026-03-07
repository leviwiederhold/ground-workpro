import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { listFallbackMessages } from "@/lib/messages/fallbackStore";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { getMyMembership } from "@/lib/messages/members";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().min(1),
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

function isMissingMessagesTables(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("message_channels") || normalized.includes("messages") || normalized.includes("message_channel_members")) &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 100, maxPageSize: 500 });
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }
    const channelId = parsedParams.data.id;

    const { supabase, companyId, userId } = await getCompanyId();

    const membership = await getMyMembership(supabase, companyId, channelId, userId);
    if (membership.error && isMissingMessagesTables(membership.error.message || "")) {
      const fallbackItems = listFallbackMessages(companyId, channelId);
      return Response.json({
        items: fallbackItems.slice(from, to + 1),
        ...getPaginationMeta(fallbackItems.length, page, pageSize),
      });
    }
    if (membership.error) return serverError();

    const channelResult = await supabase
      .from("message_channels")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", channelId)
      .maybeSingle();
    if (channelResult.error) return serverError();
    if (!channelResult.data) {
      const fallbackItems = listFallbackMessages(companyId, channelId);
      return Response.json({
        items: fallbackItems.slice(from, to + 1),
        ...getPaginationMeta(fallbackItems.length, page, pageSize),
      });
    }

    const { data, error, count } = await supabase
      .from("messages")
      .select("id, channel_id, sender_user_id, body, created_at", { count: "exact" })
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) return serverError();

    const items = data ?? [];
    return Response.json({ items, ...getPaginationMeta(count ?? items.length, page, pageSize) });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
