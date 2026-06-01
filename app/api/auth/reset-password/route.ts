import { NextResponse } from "next/server";
import { z } from "zod";
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from "@/lib/auth/passwordPolicy";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { supabaseServer } from "@/lib/supabase/server";

const resetPasswordSchema = z.object({
  password: z.string().refine(isStrongPassword, STRONG_PASSWORD_MESSAGE),
});

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "auth-reset-password",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(STRONG_PASSWORD_MESSAGE, 422);
  }

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return errorResponse("Your reset link is invalid or has expired. Request a new one.", 401);
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return errorResponse("Unable to update password. Request a new reset link and try again.", 400);
  }

  return NextResponse.json({ item: { updated: true } });
}
