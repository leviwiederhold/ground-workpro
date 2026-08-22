import { normalizeAppRole } from "../nav/config.ts";

export type WebAppAccessDecision = "allow" | "mobile-app-only";

export function getWebAppAccessDecision(input: {
  role: unknown;
  isNativeApp: boolean;
}): WebAppAccessDecision {
  if (input.isNativeApp) return "allow";
  return normalizeAppRole(input.role) === "admin" ? "allow" : "mobile-app-only";
}
