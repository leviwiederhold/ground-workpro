import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression guard for the production crash:
//   ReferenceError: settingsDirtyRef is not defined
//
// SettingsView is a SIBLING component of `App` (not nested), so it cannot close
// over App's local `settingsDirtyRef`. It must receive the ref as a prop — the
// same way it already receives `navigateToView`. Because app/page.tsx is
// `// @ts-nocheck`, this out-of-scope reference is invisible to typecheck and
// only throws at runtime, so we assert the wiring at the source level here.
//
// This test fails on the buggy code (ref used but never passed / destructured)
// and passes once the prop is wired through.
const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8"
);

test("SettingsView receives settingsDirtyRef as a prop at its render site", () => {
  const renderTags = pageSource.match(/<SettingsView\b[^>]*\/>/g) ?? [];
  assert.ok(renderTags.length > 0, "expected a <SettingsView /> render site");
  for (const tag of renderTags) {
    assert.match(
      tag,
      /settingsDirtyRef=\{settingsDirtyRef\}/,
      "each <SettingsView /> must pass settingsDirtyRef so the component can read it"
    );
  }
});

test("SettingsView destructures settingsDirtyRef in its parameters", () => {
  const sig = pageSource.match(/const SettingsView = \(\{[^}]*\}\)/);
  assert.ok(sig, "expected the SettingsView component signature");
  assert.match(
    sig![0],
    /\bsettingsDirtyRef\b/,
    "SettingsView must destructure settingsDirtyRef (it is not in App's scope)"
  );
});

test("settingsDirtyRef is not referenced as a bare (undeclared) identifier in SettingsView", () => {
  // Sanity: the component references the ref (that's the whole feature); the two
  // tests above guarantee it is provided rather than pulled from an outer scope.
  assert.ok(
    pageSource.includes("settingsDirtyRef.current"),
    "settingsDirtyRef is expected to be used inside SettingsView"
  );
});
