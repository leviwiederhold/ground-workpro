import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Guards design principle 6 (docs/attendance-decision-layer.md):
//
//   If automatic attendance is healthy, there is no manual attendance UI.
//
// The product is that an employee grants location once and never thinks about
// attendance again. "Quick Clock In", "Override Clock In", "Emergency Clock In"
// and friends each arrive with a reasonable local justification, and six months
// of them puts the app back to asking employees to press buttons.
//
// This test is deliberately structural rather than behavioural: the thing worth
// protecting is not what the component renders for one set of props, it is that
// no future contributor can attach a manual control to any other condition. If
// this test is in your way, the change you are making is what it exists to stop.

const CARD = "app/components/views/JobsiteTimeEmployeeCard.tsx";

// The ONLY permitted condition for rendering a manual attendance control.
const GUARD = "lifecycle.manualFallbackAvailable && lifecycle.manualFallbackRecommended && (";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * The source span of the guarded JSX block: from the guard's opening paren to
 * its balanced close. Anything outside this span renders unconditionally as far
 * as the fallback rule is concerned.
 */
function guardedRegion(source: string): { start: number; end: number } {
  const guardAt = source.indexOf(GUARD);
  assert.notEqual(
    guardAt,
    -1,
    `${CARD} must gate manual controls on exactly:\n  ${GUARD}\n` +
      "Manual attendance may not be shown on any other condition."
  );
  const start = guardAt + GUARD.length - 1; // the "(" itself
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  throw new Error(`Unbalanced parentheses after the manual fallback guard in ${CARD}`);
}

test("every manual attendance control is inside the fallback guard", () => {
  const source = read(CARD);
  const { start, end } = guardedRegion(source);

  // submitManual() is the only function that posts a manual attendance event.
  // Its definition lives outside the block; every CALL must be inside it.
  const calls: number[] = [];
  const needle = "submitManual(";
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    // Skip the declaration itself ("const submitManual = useCallback(").
    if (/const\s+submitManual\s*=/.test(source.slice(Math.max(0, i - 40), i + needle.length))) continue;
    calls.push(i);
  }

  assert.ok(calls.length > 0, "expected the manual fallback block to still offer manual clock in/out");
  for (const at of calls) {
    const line = source.slice(0, at).split("\n").length;
    assert.ok(
      at > start && at < end,
      `${CARD}:${line} calls submitManual() outside the manual fallback guard. ` +
        "A manual attendance control may only render when automatic attendance cannot operate."
    );
  }
});

test("no other component offers a manual attendance action", () => {
  // The wire-level chokepoint: a manual attendance event is a POST to
  // /api/jobsite-time/events carrying source: 'manual'. A "Quick Clock In"
  // button added anywhere else in the app would have to do this, and would fail
  // here rather than quietly shipping.
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) {
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (rel === CARD) continue;
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      if (/source:\s*['"]manual['"]/.test(source) && /jobsite-time\/events/.test(source)) {
        offenders.push(rel);
      }
    }
  };
  walk("app/components");

  assert.deepEqual(
    offenders,
    [],
    "Manual attendance may only be initiated from the guarded fallback block in " +
      `${CARD}. Found another manual clock-in path in: ${offenders.join(", ")}`
  );
});

/**
 * The source span of every <button>/<Button> element, with its inner text.
 * Crude but sufficient: attendance controls are plain buttons, and a check that
 * only understands buttons will not trip over the manager correction form's
 * "Clock in"/"Clock out" <label> elements.
 */
function buttonElements(source: string): Array<{ at: number; open: string; text: string }> {
  const found: Array<{ at: number; open: string; text: string }> = [];
  const re = /<(button|Button)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const tag = m[1];
    // End of the opening tag: the first ">" not inside a JSX expression.
    let depth = 0;
    let openEnd = -1;
    for (let i = m.index + m[0].length; i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) {
        openEnd = i;
        break;
      }
    }
    if (openEnd === -1) continue;
    const open = source.slice(m.index, openEnd + 1);
    if (source[openEnd - 1] === "/") {
      found.push({ at: m.index, open, text: "" });
      continue;
    }
    const closeAt = source.indexOf(`</${tag}>`, openEnd);
    found.push({ at: m.index, open, text: closeAt === -1 ? "" : source.slice(openEnd + 1, closeAt) });
  }
  return found;
}

const CLOCKING_LABEL = /clock\s*-?\s*(in|out)\b/i;

/**
 * Whether a button belongs to the GENERIC time clock (`time_entries`), which is
 * a separate feature from jobsite attendance and legitimately has clock in/out
 * buttons. Recognised by what it actually posts to, not by where it lives.
 */
function drivesGenericTimeClock(source: string, open: string): boolean {
  const onClick = open.match(/onClick=\{([^}]*)\}/)?.[1] ?? "";
  if (/time-clock/.test(onClick)) return true;
  const handler = onClick.match(/\b([A-Za-z_$][\w$]*)\s*$/)?.[1];
  if (!handler) return false;
  const defAt = source.search(new RegExp(`(const|function)\\s+${handler}\\b`));
  if (defAt === -1) return false;
  return /\/api\/time-clock\//.test(source.slice(defAt, defAt + 800));
}

test("no employee-facing clock in/out button renders outside the fallback flow", () => {
  // The broad net: a future PR that adds a clocking button to any employee
  // surface fails here, whatever it is called and wherever it is put. The one
  // documented exception is the generic time clock, which is a different
  // feature and is identified by the endpoint it posts to.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel);
      else if (/\.tsx$/.test(entry)) files.push(rel);
    }
  };
  walk("app/components");
  files.push("app/page.tsx");

  const offenders: string[] = [];
  for (const rel of files) {
    const source = read(rel);
    const guard = source.includes(GUARD) ? guardedRegion(source) : null;

    for (const button of buttonElements(source)) {
      if (!CLOCKING_LABEL.test(button.text)) continue;
      if (guard && button.at > guard.start && button.at < guard.end) continue;
      if (drivesGenericTimeClock(source, button.open)) continue;
      const line = source.slice(0, button.at).split("\n").length;
      offenders.push(`${rel}:${line} — ${button.text.trim().slice(0, 60).replace(/\s+/g, " ")}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "An employee-facing clock in/out control renders outside the manual fallback " +
      "guard:\n  " +
      offenders.join("\n  ") +
      "\n\nAutomatic attendance is the workflow. A manual control may only render " +
      "when lifecycle.manualFallbackRecommended is true — see design principle 6 " +
      "in docs/attendance-decision-layer.md."
  );
});

test("the employee card never renders an unconditional clock in/out button", () => {
  const source = read(CARD);
  const { start, end } = guardedRegion(source);
  const outside = source.slice(0, start) + source.slice(end);

  // Copy that would put a clocking affordance in front of an employee whose
  // automatic attendance is working fine.
  const banned = /\b(quick|override|emergency|temporary|force)\s+clock\s*-?\s*(in|out)\b/i;
  const match = outside.match(banned);
  assert.equal(
    match,
    null,
    `${CARD} offers "${match?.[0]}" outside the fallback guard. ` +
      "Automatic attendance is the workflow; manual is an exception, not a shortcut."
  );
});
