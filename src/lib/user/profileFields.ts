export const PROFILE_TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Arizona Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
] as const;

export function sanitizeProfileFullName(fullName: unknown, email: unknown) {
  const normalizedFullName = String(fullName ?? "").trim();
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedFullName) return "";
  if (normalizedEmail && normalizedFullName.toLowerCase() === normalizedEmail) return "";
  return normalizedFullName;
}

export function normalizeTimezoneOption(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const matchedOption = PROFILE_TIMEZONE_OPTIONS.find((option) => option.value === normalized);
  return matchedOption?.value ?? normalized;
}

export function extractUsPhoneDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 10);
}

export function formatUsPhoneInput(value: unknown) {
  const digits = extractUsPhoneDigits(value);
  if (!digits) return "";
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePhoneForStorage(value: unknown) {
  return formatUsPhoneInput(value);
}
