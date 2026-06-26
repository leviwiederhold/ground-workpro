import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/http/errorResponse";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Enter a name for your team chat.").max(120),
});

/**
 * PATCH /api/messages/companywide
 *
 * Name (or rename) the company's permanent company-wide chat. Owner/admin only.
 * Updates the EXISTING companywide thread — never creates a second group chat.
 */
export async function PATCH(request: Request) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return errorResponse("Only an owner/admin can rename the team chat.", 403);
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || "Invalid name", 422);
    }

    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    const update = await db
      .from("message_threads")
      .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("is_companywide", true)
      .select("id, name")
      .maybeSingle();

    if (update.error) {
      return errorResponse(update.error.message, 400);
    }
    if (!update.data) {
      return errorResponse("Company chat not found.", 404);
    }

    return Response.json({ item: { id: update.data.id, name: update.data.name } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
  }
}
