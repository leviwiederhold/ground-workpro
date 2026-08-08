import { timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedPushDispatchRequest(request: Request, configuredSecret: string | undefined): boolean {
  const secret = String(configuredSecret ?? "").trim();
  if (!secret) return false;
  const authorization = String(request.headers.get("authorization") ?? "");
  if (!authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice(7).trim(), secret);
}
