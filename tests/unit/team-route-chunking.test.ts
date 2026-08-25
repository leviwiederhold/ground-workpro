import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function codeOnly(source: string) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

test("Team chunks every lookup over the full membership population", () => {
  const source = codeOnly(read("app/api/team/route.ts"));
  assert.match(source, /from "@\/lib\/db\/chunk"/);
  assert.match(source, /for \(const memberUserIdChunk of chunkValues\(memberUserIds\)\)/);
  assert.match(source, /\.in\("accepted_user_id", memberUserIdChunk\)/);
  assert.match(source, /\.in\("id", memberUserIdChunk\)/);
  assert.doesNotMatch(source, /\.in\("(?:accepted_user_id|id)", memberUserIds\)/);
});

test("Team weekly-hours lookup is also bounded for membership-only users", () => {
  const source = codeOnly(read("src/lib/time-clock/summary.ts"));
  assert.match(source, /for \(const userIdChunk of chunkValues\(uniqueUserIds\)\)/);
  assert.match(source, /\.in\("user_id", userIdChunk\)/);
  assert.doesNotMatch(source, /\.in\("user_id", uniqueUserIds\)/);
});

test("Team keeps canonical roles, job titles, membership-only rows, and the response contract", () => {
  const source = read("app/api/team/route.ts");
  assert.match(source, /resolveCompanyTeamRole/);
  assert.match(source, /primaryOwnerUserId/);
  assert.match(source, /id: `membership:\$\{membershipUserId\}`/);
  assert.match(source, /recordSource: "membership"/);
  assert.match(source, /jobTitle: item\.jobTitle/);
  assert.match(source, /accountStatus: item\.accountStatus/);
});

test("Team view cannot crash by reading App's out-of-scope currentView state", () => {
  const page = read("app/page.tsx");
  const teamView = page.slice(
    page.indexOf("const TeamView ="),
    page.indexOf("const MaintenanceView =", page.indexOf("const TeamView =")),
  );

  assert.ok(teamView.length > 0);
  assert.doesNotMatch(teamView, /\bcurrentView\b/);
  assert.match(teamView, /window\.addEventListener\('focus', refreshInviteState\)/);
});
