'use client';

import { PASSWORD_RULES } from "@/lib/auth/passwordPolicy";

/** Live password-requirement checklist shown under password inputs. */
export default function PasswordChecklist({ value }: { value: string }) {
  if (!value) {
    return (
      <p className="mt-1.5 text-xs text-gray-400">
        Use 10+ characters with uppercase, lowercase, a number, and a symbol.
      </p>
    );
  }
  return (
    <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        return (
          <li key={rule.key} className={`flex items-center gap-1.5 text-xs ${ok ? "text-emerald-600" : "text-gray-400"}`}>
            <span aria-hidden="true">{ok ? "✓" : "○"}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
