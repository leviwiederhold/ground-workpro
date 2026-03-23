import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import {
  createGroupThread,
  ensureCompanyMember,
  getOrCreateDirectThread,
  resolveDisplayNames,
} from "@/lib/messages/mvp";

export { GET } from "@/app/api/messages/inbox/route";

export const dynamic = "force-dynamic";

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  memberUserIds: z.array(z.string().uuid()).default([]),
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

export async function POST(request: Request) {
  try {
    const parsedBody = createChannelSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const targetUserIds = Array.from(
      new Set(
        (parsedBody.data.memberUserIds ?? [])
          .map((id) => String(id))
          .filter((id) => id && id !== String(userId))
      )
    );

    if (targetUserIds.length === 0) {
      return validationError([
        {
          path: "memberUserIds",
          message: "Select at least one teammate.",
        },
      ]);
    }

    const membershipChecks = await Promise.all(
      targetUserIds.map(async (memberUserId) => ({
        userId: memberUserId,
        isMember: await ensureCompanyMember(supabase, companyId, memberUserId),
      }))
    );
    const missingMember = membershipChecks.find((row) => !row.isMember);
    if (missingMember) return notFound("User not found");

    if (targetUserIds.length === 1) {
      const otherUserId = targetUserIds[0];
      const thread = await getOrCreateDirectThread(supabase, companyId, userId, otherUserId);
      const names = await resolveDisplayNames(supabase, companyId, [otherUserId]);

      return okItem(
        {
          id: thread.id,
          kind: "direct",
          name: names.get(otherUserId) || "Team Member",
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          other_user_id: otherUserId,
          member_count: 2,
        },
        201
      );
    }

    const thread = await createGroupThread(supabase, companyId, userId, targetUserIds);
    const computedName = parsedBody.data.name?.trim() || "Group Chat";

    return okItem(
      {
        id: thread.id,
        kind: "group",
        name: computedName,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        other_user_id: null,
        member_count: targetUserIds.length + 1,
      },
      201
    );
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
