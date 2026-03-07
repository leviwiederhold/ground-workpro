/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { getPublicProposalByToken } from "@/lib/proposals/publicProposal";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
const ROUTE = "/api/proposals/[token]";

const paramsSchema = z.object({
  token: z.string().min(24),
});

const toValidationError = (error: any) => ({
  error: "Validation error",
  details: error.issues.map((issue: any) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "proposal-read",
    limit: 240,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const rawParams = await params;
    const parsedParams = paramsSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return errorResponse("Validation error", 422, {
        details: toValidationError(parsedParams.error).details,
      });
    }

    const result = await getPublicProposalByToken(parsedParams.data.token);
    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    return Response.json({ item: result.item });
  } catch {
    return errorResponse("Internal server error", 500, {
      context: { route: ROUTE, role: "public_token" },
    });
  }
}
