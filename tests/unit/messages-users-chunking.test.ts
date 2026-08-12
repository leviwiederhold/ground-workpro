import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkValues } from "../../src/lib/db/chunk.ts";

// The shared E2E company has ~737 other memberships. A single PostgREST
// `.in("col", userIds)` filter over a population that large overflows the
// request URL and comes back as a Bad Request — the failure `/api/messages/users`
// reproduced (HTTP 500) after `/api/company-members` was already chunked.
const LARGE_POPULATION = 737;

const largeIds = Array.from({ length: LARGE_POPULATION }, (_, index) => `user-${index}`);

test("chunkValues splits a large membership population into <=100-id groups", () => {
  const chunks = chunkValues(largeIds);
  // 737 -> seven full chunks of 100 plus a final chunk of 37.
  assert.equal(chunks.length, 8);
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0 && chunk.length <= 100, `chunk length ${chunk.length} out of range`);
  }
  assert.equal(chunks[chunks.length - 1].length, 37);
});

test("chunkValues partitions userIds exactly — no duplicates, no omissions, boundaries kept", () => {
  const flattened = chunkValues(largeIds).flat();
  // Order preserved and every id present exactly once (Set collapses duplicates).
  assert.deepEqual(flattened, largeIds);
  assert.equal(flattened.length, LARGE_POPULATION);
  assert.equal(new Set(flattened).size, LARGE_POPULATION);
  // The users straddling a chunk boundary (index 99 -> 100) and the final id
  // must each appear exactly once — these are the users a naive split drops.
  for (const boundaryId of ["user-99", "user-100", "user-699", "user-736"]) {
    assert.equal(flattened.filter((id) => id === boundaryId).length, 1, `${boundaryId} not kept exactly once`);
  }
});

test("chunkValues handles empty and boundary-sized populations", () => {
  assert.deepEqual(chunkValues([]), []);
  assert.deepEqual(chunkValues(["a", "b"]), [["a", "b"]]);
  assert.equal(chunkValues(Array.from({ length: 100 }, (_, i) => i)).length, 1);
  assert.equal(chunkValues(Array.from({ length: 101 }, (_, i) => i)).length, 2);
});

// Source guard: the route must keep using chunked lookups so it can't silently
// regress to a single unchunked `.in(userIds)` that 500s for large companies.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const routeSource = readFileSync(join(repoRoot, "app/api/messages/users/route.ts"), "utf8");

test("messages/users route chunks every membership .in() lookup", () => {
  assert.match(routeSource, /from "@\/lib\/db\/chunk"/);
  assert.match(routeSource, /\.in\("id",\s*userIdChunk\)/);
  assert.match(routeSource, /\.in\("user_id",\s*userIdChunk\)/);
  assert.match(routeSource, /\.in\("accepted_user_id",\s*userIdChunk\)/);
  const loops = routeSource.match(/for \(const userIdChunk of chunkValues\(userIds\)\)/g) ?? [];
  assert.equal(loops.length, 3, "expected profiles, employees and pending_invitations to each chunk userIds");
});

test("messages/users route no longer issues an unchunked .in(userIds)", () => {
  // Ignore comment lines so prose that mentions `.in(userIds)` can't trip this.
  const code = routeSource
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
  assert.doesNotMatch(code, /\.in\(\s*"[^"]+",\s*userIds\s*\)/);
});

test("messages/users preserves its exact response contract", () => {
  // Exactly these four keys — distinct from /api/company-members' richer shape.
  assert.match(routeSource, /userId:\s*row\.user_id/);
  assert.match(routeSource, /role:\s*toRoleLabel\(/);
  assert.match(routeSource, /displayName:\s*nameById\.get/);
  assert.match(routeSource, /avatarUrl:\s*avatarById\.get/);
  assert.doesNotMatch(routeSource, /roleLabel:/);
  assert.doesNotMatch(routeSource, /accessProfile:/);
});
