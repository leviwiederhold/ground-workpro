import { randomBytes } from "crypto";

export function generateShareToken(byteLength = 24): string {
  return randomBytes(byteLength).toString("base64url");
}

// Backward-compatible alias for existing callers.
export const generateSecureToken = generateShareToken;
