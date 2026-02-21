import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { createFallbackChannel, listFallbackChannels } from "@/lib/messages/fallbackStore";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

export const dynamic = "force-dynamic";

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
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
    (normalized.includes("message_channels") || normalized.includes("messages")) &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId } = await getCompanyId();

    const channelsResult = await supabase
      .from("message_channels")
      .select("id, name, created_at, updated_at", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (channelsResult.error) {
      const message = channelsResult.error?.message || "";
      if (isMissingMessagesTables(message)) {
        const fallback = listFallbackChannels(companyId);
        const paged = fallback.slice(from, to + 1);
        return Response.json({ items: paged, ...getPaginationMeta(fallback.length, page, pageSize) });
      }
      return serverError();
    }

    const channelIds = (channelsResult.data ?? []).map((c) => c.id);
    const messagesQuery =
      channelIds.length > 0
        ? await supabase
            .from("messages")
            .select("id, channel_id, body, created_at")
            .eq("company_id", companyId)
            .in("channel_id", channelIds)
            .order("created_at", { ascending: false })
        : { data: [], error: null };

    if (messagesQuery.error) {
      if (isMissingMessagesTables(messagesQuery.error.message || "")) {
        const fallback = listFallbackChannels(companyId);
        const paged = fallback.slice(from, to + 1);
        return Response.json({ items: paged, ...getPaginationMeta(fallback.length, page, pageSize) });
      }
      return serverError();
    }

    const latestByChannel = new Map<string, { body: string; created_at: string }>();
    const countsByChannel = new Map<string, number>();

    for (const msg of messagesQuery.data ?? []) {
      const channelId = String(msg.channel_id);
      if (!countsByChannel.has(channelId)) {
        countsByChannel.set(channelId, 0);
      }
      countsByChannel.set(channelId, (countsByChannel.get(channelId) ?? 0) + 1);
      if (!latestByChannel.has(channelId)) {
        latestByChannel.set(channelId, {
          body: String(msg.body ?? ""),
          created_at: String(msg.created_at ?? ""),
        });
      }
    }

    const items = (channelsResult.data ?? []).map((channel) => {
      const key = String(channel.id);
      const latest = latestByChannel.get(key);
      return {
        id: channel.id,
        name: channel.name,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        message_count: countsByChannel.get(key) ?? 0,
        last_message_at: latest?.created_at ?? null,
        last_message_preview: latest?.body ?? null,
      };
    });

    return Response.json({
      items,
      ...getPaginationMeta(channelsResult.count ?? items.length, page, pageSize),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return forbidden();
    }

    const parsedBody = createChannelSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId } = await getCompanyId();
    const now = new Date().toISOString();
    const payload = {
      company_id: companyId,
      name: parsedBody.data.name,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("message_channels")
      .insert(payload)
      .select("id, name, created_at, updated_at")
      .single();

    if (error || !data) {
      if (error?.message && isMissingMessagesTables(error.message)) {
        return okItem(createFallbackChannel(companyId, parsedBody.data.name), 201);
      }
      return serverError();
    }

    return okItem(data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
