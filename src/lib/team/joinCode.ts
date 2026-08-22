import { createHash, randomInt } from "node:crypto";
import { z } from "zod";

export const EMPLOYEE_JOIN_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const EMPLOYEE_JOIN_MEMBERSHIP_ROLE = "operator" as const;
export const EMPLOYEE_JOIN_PROFILE_ROLE = "operator" as const;

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const employeeJoinCodeSchema = z
  .string()
  .transform((value) => normalizeEmployeeJoinCode(value))
  .pipe(z.string().regex(/^[A-Z2-9]{6}$/, "Enter a valid 6-character company code"));

// Strict on purpose: a joining user cannot smuggle a role or permission choice
// into the acceptance request.
export const employeeJoinAcceptSchema = z
  .object({
    code: employeeJoinCodeSchema,
    full_name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type EmployeeJoinCodeRow = {
  company_id: string;
  code_digest: string;
  created_at: string;
  expires_at: string;
};

export type EmployeeJoinCodeStatus =
  | "valid"
  | "not_found"
  | "expired"
  | "company_inactive";

export function normalizeEmployeeJoinCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}
export function hashEmployeeJoinCode(value: unknown): string {
  return createHash("sha256").update(normalizeEmployeeJoinCode(value), "utf8").digest("hex");
}

export function generateEmployeeJoinCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(0, JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function createEmployeeJoinCodeTimes(now: Date = new Date()): {
  createdAt: string;
  expiresAt: string;
} {
  const createdAtMs = now.getTime();
  return {
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + EMPLOYEE_JOIN_CODE_LIFETIME_MS).toISOString(),
  };
}

export function getEmployeeJoinCodeStatus(input: {
  row: EmployeeJoinCodeRow | null;
  submittedDigest: string;
  companyActive: boolean;
  now?: Date;
}): EmployeeJoinCodeStatus {
  if (!input.row || input.row.code_digest !== input.submittedDigest) return "not_found";
  if (Date.parse(input.row.expires_at) <= (input.now ?? new Date()).getTime()) return "expired";
  if (!input.companyActive) return "company_inactive";
  return "valid";
}
