import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";

const bodySchema = z.object({
  role: z.enum(["admin", "pm", "foreman", "mechanic", "operator"]),
});

const toValidationError = (issues: { path: (string | number)[]; message: string }[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const response = NextResponse.json({ item: { role: parsed.data.role }, success: true });
    response.cookies.set("e2e_role", parsed.data.role, { path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
