import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const FEEDBACK_DESTINATION = "info@formanusa.com";

const feedbackSchema = z.object({
  feedback_type: z.enum(["bug", "feature_request", "general_feedback"]),
  message: z.string().trim().min(5, "Please include a bit more detail.").max(2000, "Message must be 2000 characters or fewer."),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Please enter a valid email address.").max(200).optional().or(z.literal("")),
  page: z.string().trim().max(200).optional().or(z.literal("")),
  current_view: z.string().trim().max(120).optional().or(z.literal("")),
});

const feedbackTypeLabel = {
  bug: "Bug",
  feature_request: "Feature Request",
  general_feedback: "General Feedback",
} as const;

function formatMultilineValue(value: string) {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const { companyId, userId, userEmail } = await getCompanyId();
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
    const typeLabel = feedbackTypeLabel[payload.feedback_type];
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(FEEDBACK_DESTINATION)}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        _subject: `[Groundwork Pro Beta] ${typeLabel}`,
        _captcha: "false",
        _template: "table",
        product: "Groundwork Pro",
        feedback_type: typeLabel,
        message: formatMultilineValue(payload.message),
        name: payload.name || "Not provided",
        email: payload.email || userEmail || "Not provided",
        page: payload.page || "Unknown",
        current_view: payload.current_view || "Unknown",
        company_id: companyId,
        user_id: userId,
        submitted_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return NextResponse.json(
        { error: errorText || "Feedback could not be sent right now. Please try again." },
        { status: 502 }
      );
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
