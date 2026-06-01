// Shared strong-password policy used by signup, reset, and change-password flows
// on both client (live checklist) and server (validation).

export type PasswordRule = {
  key: string;
  label: string;
  test: (value: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  { key: "length", label: "At least 10 characters", test: (v) => v.length >= 10 },
  { key: "upper", label: "One uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { key: "lower", label: "One lowercase letter", test: (v) => /[a-z]/.test(v) },
  { key: "number", label: "One number", test: (v) => /[0-9]/.test(v) },
  { key: "symbol", label: "One symbol", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function evaluatePassword(value: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const rule of PASSWORD_RULES) result[rule.key] = rule.test(value || "");
  return result;
}

export function isStrongPassword(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value || ""));
}

export const STRONG_PASSWORD_MESSAGE =
  "Password must be at least 10 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";
