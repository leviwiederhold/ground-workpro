import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enqueueOutboxEvent } from "@/lib/outbox/queue";

const feedbackSchema = z.object({
  feedback_type: z.enum(["bug", "feature_request", "general_feedback"]),
  message: z.string().trim().min(5, "Please include a bit more detail.").max(2000, "Message must be 2000 characters or fewer."),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Please enter a valid email address.").max(200).optional().or(z.literal("")),
  page: z.string().trim().max(200).optional().or(z.literal("")),
  current_view: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const body = await request.json().catch(() => null);
    const parsed = feedbackSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message || "Invalid feedback submission.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const payload = parsed.data;
    const record = {
      company_id: companyId,
      user_id: userId,
      feedback_type: payload.feedback_type,
      message: payload.message,
      name: payload.name || null,
      email: payload.email || null,
      page: payload.page || null,
      current_view: payload.current_view || null,
    };

    const insertResult = await supabase.from("feedback_submissions").insert(record);

    if (insertResult.error) {
      const admin = getSupabaseAdmin();

      if (admin) {
        const adminInsertResult = await admin.from("feedback_submissions").insert(record);
        if (!adminInsertResult.error) {
          return NextResponse.json({ ok: true, saved_via: "admin" });
        }
      }

      try {
        await enqueueOutboxEvent(supabase, {
          companyId,
          eventType: "feedback.submitted",
          aggregateType: "feedback",
          aggregateId: userId,
          payload: {
            ...record,
            submitted_at: new Date().toISOString(),
          },
          idempotencyKey: `feedback:${companyId}:${userId}:${String(payload.page || "")}:${payload.message.slice(0, 64)}`,
          maxAttempts: 8,
        });
        return NextResponse.json({ ok: true, saved_via: "outbox_fallback" });
      } catch {
        return NextResponse.json(
          { error: "Feedback could not be sent right now. Please try again." },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
