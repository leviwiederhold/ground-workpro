// Pure orchestration for the single "Save Changes" action on the Settings page.
// Kept UI-free so the multi-section save behavior is unit-testable:
//   - only DIRTY sections are sent
//   - a section that fails (rejects or returns false) is reported, and its
//     failure must prevent an overall "Saved" result
//   - one section failing never blocks the others from being attempted

export type SettingsSaveSection = {
  // Human label surfaced in the "Couldn't save: …" message.
  label: string;
  // Whether this section has unsaved edits. Clean sections are skipped.
  dirty: boolean;
  // Performs the save. Resolve true on success (and commit the new baseline),
  // false (or throw) on failure. Must NOT throw for a normal API error.
  run: () => Promise<boolean>;
};

export type SettingsSaveResult = {
  ok: boolean;
  failed: string[];
  attempted: string[];
};

export async function runUnifiedSave(
  sections: SettingsSaveSection[]
): Promise<SettingsSaveResult> {
  const failed: string[] = [];
  const attempted: string[] = [];
  for (const section of sections) {
    if (!section.dirty) continue;
    attempted.push(section.label);
    try {
      const ok = await section.run();
      if (!ok) failed.push(section.label);
    } catch {
      failed.push(section.label);
    }
  }
  return { ok: failed.length === 0, failed, attempted };
}

// The save-state a section-based save collapses to. 'saved' is ONLY returned
// when nothing failed — a partial failure never reports success.
export function settingsSaveState(result: SettingsSaveResult): "saved" | "error" {
  return result.ok ? "saved" : "error";
}
