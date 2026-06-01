import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { supabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().trim().max(160).optional(),
});

function isExistingAccountError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered");
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "auth-signup",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const payload = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse("Invalid signup payload", 422);
  }

  try {
    const supabase = await supabaseServer();
    const fullName = parsed.data.full_name?.trim();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      ...(fullName ? { options: { data: { full_name: fullName } } } : {}),
    });

    if (error) {
      if (isExistingAccountError(error.message)) {
        return NextResponse.json({
          item: {
            existingAccount: true,
            authError: null,
            hasSession: false,
            identityCount: 0,
            userId: null,
          },
        });
      }
      return NextResponse.json({
        item: {
          existingAccount: false,
          authError: error.message,
          hasSession: false,
          identityCount: 0,
          userId: null,
        },
      });
    }

    const identityCount = Array.isArray(data.user?.identities) ? data.user.identities.length : 1;

    return NextResponse.json({
      item: {
        existingAccount: false,
        authError: null,
        hasSession: Boolean(data.session),
        identityCount,
        userId: data.user?.id ?? null,
      },
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as { code?: string; hostname?: string } | undefined) : undefined;
    const hostname = cause?.hostname ? ` (${cause.hostname})` : "";
    const authError =
      cause?.code === "ENOTFOUND"
        ? `Unable to reach Supabase Auth${hostname}. Check NEXT_PUBLIC_SUPABASE_URL and your network/DNS.`
        : "Unable to reach auth service. Please try again.";

    return NextResponse.json({
      item: {
        existingAccount: false,
        authError,
        hasSession: false,
        identityCount: 0,
        userId: null,
      },
    });
  }
}
