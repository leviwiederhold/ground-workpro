import { expect, test } from "@playwright/test";
import { getBackoffSeconds, getNextRunAt } from "@/lib/bg-jobs/queue";

test("bg jobs backoff grows and is capped", () => {
  expect(getBackoffSeconds(1)).toBe(30);
  expect(getBackoffSeconds(2)).toBe(60);
  expect(getBackoffSeconds(3)).toBe(120);
  expect(getBackoffSeconds(10)).toBe(3600);
  expect(getBackoffSeconds(100)).toBe(3600);
});

test("bg jobs next run at uses attempt-based backoff", () => {
  const from = new Date("2026-02-21T00:00:00.000Z");
  expect(getNextRunAt(1, from)).toBe("2026-02-21T00:00:30.000Z");
  expect(getNextRunAt(2, from)).toBe("2026-02-21T00:01:00.000Z");
});
