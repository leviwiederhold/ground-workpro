import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import {
  listMessagesByThreadIds,
  listParticipantRowsForThreads,
  listParticipantRowsForUser,
  listThreadsByIds,
  resolveDisplayNames,
} from "@/lib/messages/mvp";

export const dynamic = "force-dynamic";

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsedQuery.success) return validationError(toValidationDetails(parsedQuery.error));

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, {
      defaultPageSize: 50,
      maxPageSize: 200,
    });

    const { supabase, companyId, userId } = await getCompanyId();

    const myParticipants = await listParticipantRowsForUser(supabase, companyId, userId);
    const threadIds = Array.from(new Set(myParticipants.map((row) => String(row.thread_id))));

    if (threadIds.length === 0) {
      return Response.json({
        items: [],
        unread_count: 0,
        ...getPaginationMeta(0, page, pageSize),
      });
    }

    const [threads, allParticipants, allMessages] = await Promise.all([
      listThreadsByIds(supabase, companyId, threadIds),
      listParticipantRowsForThreads(supabase, companyId, threadIds),
      listMessagesByThreadIds(supabase, companyId, threadIds),
    ]);

    const otherUserIds = Array.from(
      new Set(
        allParticipants
          .map((row) => String(row.user_id))
          .filter((participantUserId) => participantUserId && participantUserId !== String(userId))
      )
    );
    const displayNames = await resolveDisplayNames(supabase, companyId, otherUserIds);

    const readAtByThread = new Map<string, number>();
    for (const row of myParticipants) {
      readAtByThread.set(
        String(row.thread_id),
        row.last_read_at ? new Date(row.last_read_at).getTime() : 0
      );
    }

    const participantsByThread = new Map<string, string[]>();
    for (const row of allParticipants) {
      const key = String(row.thread_id);
      const users = participantsByThread.get(key) ?? [];
      users.push(String(row.user_id));
      participantsByThread.set(key, users);
    }

    const latestByThread = new Map<string, { body: string; created_at: string }>();
    const countByThread = new Map<string, number>();
    const unreadByThread = new Map<string, number>();

    for (const msg of allMessages) {
      const key = String(msg.thread_id);
      if (!latestByThread.has(key)) {
        latestByThread.set(key, {
          body: String(msg.body ?? ""),
          created_at: String(msg.created_at ?? ""),
        });
      }
      countByThread.set(key, (countByThread.get(key) ?? 0) + 1);

      const createdAt = msg.created_at ? new Date(msg.created_at).getTime() : 0;
      const readAt = readAtByThread.get(key) ?? 0;
      if (String(msg.sender_user_id) !== String(userId) && createdAt > readAt) {
        unreadByThread.set(key, (unreadByThread.get(key) ?? 0) + 1);
      }
    }

    const items = threads
      .map((thread) => {
        const key = String(thread.id);
        const participants = Array.from(new Set(participantsByThread.get(key) ?? []));
        const otherUserId = participants.find((id) => id !== String(userId)) ?? null;
        const latest = latestByThread.get(key);
        return {
          id: thread.id,
          kind: "direct",
          name: otherUserId ? displayNames.get(String(otherUserId)) || "Team Member" : "Team Member",
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          message_count: countByThread.get(key) ?? 0,
          unread_count: unreadByThread.get(key) ?? 0,
          last_message_at: latest?.created_at ?? thread.last_message_at ?? null,
          last_message_preview: latest?.body ?? null,
          member_count: participants.length,
          other_user_id: otherUserId,
        };
      })
      .sort((a, b) =>
        String(b.last_message_at || b.updated_at || b.created_at).localeCompare(
          String(a.last_message_at || a.updated_at || a.created_at)
        )
      );

    const totalUnread = items.reduce((sum, item) => sum + Number(item.unread_count ?? 0), 0);

    return Response.json({
      items: items.slice(from, to + 1),
      unread_count: totalUnread,
      ...getPaginationMeta(items.length, page, pageSize),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
