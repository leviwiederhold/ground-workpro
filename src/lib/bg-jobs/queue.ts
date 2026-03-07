import { z } from "zod";

export const bgJobTypeSchema = z.enum(["stub.sync"]);
export type BgJobType = "stub.sync";

export const bgJobStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type BgJobStatus = "queued" | "processing" | "completed" | "failed";

export const enqueueBgJobSchema = z.object({
  type: bgJobTypeSchema,
  payload: z.record(z.any()).optional().default({}),
  run_at: z.string().datetime().optional(),
  max_attempts: z.number().int().min(1).max(25).optional().default(5),
});

export const claimBgJobsParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export type StubSyncPayload = {
  marker?: string;
  shouldFail?: boolean;
  failUntilAttempt?: number;
};

export function getBackoffSeconds(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(3600, 30 * 2 ** (safeAttempt - 1));
}

export function getNextRunAt(attempt: number, from = new Date()): string {
  const seconds = getBackoffSeconds(attempt);
  return new Date(from.getTime() + seconds * 1000).toISOString();
}
