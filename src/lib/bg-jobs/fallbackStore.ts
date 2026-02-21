type BgJobRecord = {
  id: string;
  type: string;
  company_id: string;
  payload: Record<string, unknown>;
  status: "queued" | "processing" | "completed" | "failed";
  run_at: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type BgJobDlqRecord = {
  id: string;
  bg_job_id: string | null;
  type: string;
  company_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  failed_at: string;
};

type BgJobsFallbackState = {
  jobs: Map<string, BgJobRecord[]>;
  dlq: Map<string, BgJobDlqRecord[]>;
};

const fallbackState = (() => {
  const globalRef = globalThis as typeof globalThis & {
    __GROUNDWORK_BG_JOBS_FALLBACK__?: BgJobsFallbackState;
  };
  if (!globalRef.__GROUNDWORK_BG_JOBS_FALLBACK__) {
    globalRef.__GROUNDWORK_BG_JOBS_FALLBACK__ = {
      jobs: new Map<string, BgJobRecord[]>(),
      dlq: new Map<string, BgJobDlqRecord[]>(),
    };
  }
  return globalRef.__GROUNDWORK_BG_JOBS_FALLBACK__;
})();

const jobs = fallbackState.jobs;
const dlq = fallbackState.dlq;

function getJobs(companyId: string) {
  const existing = jobs.get(companyId);
  if (existing) return existing;
  const created: BgJobRecord[] = [];
  jobs.set(companyId, created);
  return created;
}

function getDlq(companyId: string) {
  const existing = dlq.get(companyId);
  if (existing) return existing;
  const created: BgJobDlqRecord[] = [];
  dlq.set(companyId, created);
  return created;
}

export function isMissingBgJobsSchema(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("bg_jobs") || normalized.includes("claim_bg_jobs")) &&
    (normalized.includes("does not exist") ||
      normalized.includes("schema cache") ||
      normalized.includes("could not find") ||
      normalized.includes("function"))
  );
}

export function enqueueBgJobFallback(input: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
  runAt: string;
  maxAttempts: number;
}): BgJobRecord {
  const nowIso = new Date().toISOString();
  const record: BgJobRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    company_id: input.companyId,
    payload: input.payload,
    status: "queued",
    run_at: input.runAt,
    attempts: 0,
    max_attempts: input.maxAttempts,
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  getJobs(input.companyId).push(record);
  return record;
}

export function listBgJobsFallback(companyId: string, limit: number, status?: string): BgJobRecord[] {
  const rows = getJobs(companyId)
    .filter((job) => (status ? job.status === status : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.slice(0, limit);
}

export function claimBgJobsFallback(companyId: string, limit: number): BgJobRecord[] {
  const nowMs = Date.now();
  const rows = getJobs(companyId)
    .filter((job) => job.status === "queued" && new Date(job.run_at).getTime() <= nowMs)
    .sort((a, b) => (a.run_at > b.run_at ? 1 : -1))
    .slice(0, limit);

  for (const job of rows) {
    job.status = "processing";
    job.attempts += 1;
    job.updated_at = new Date().toISOString();
  }
  return rows;
}

export function setAllQueuedDueFallback(companyId: string) {
  const nowIso = new Date().toISOString();
  for (const job of getJobs(companyId)) {
    if (job.status === "queued") {
      job.run_at = nowIso;
      job.updated_at = nowIso;
    }
  }
}

export function markBgJobCompletedFallback(companyId: string, jobId: string) {
  const job = getJobs(companyId).find((item) => item.id === jobId);
  if (!job) return;
  job.status = "completed";
  job.last_error = null;
  job.updated_at = new Date().toISOString();
}

export function markBgJobRetryFallback(companyId: string, jobId: string, nextRunAt: string, lastError: string) {
  const job = getJobs(companyId).find((item) => item.id === jobId);
  if (!job) return;
  job.status = "queued";
  job.run_at = nextRunAt;
  job.last_error = lastError;
  job.updated_at = new Date().toISOString();
}

export function markBgJobFailedFallback(companyId: string, jobId: string, lastError: string) {
  const job = getJobs(companyId).find((item) => item.id === jobId);
  if (!job) return;
  job.status = "failed";
  job.last_error = lastError;
  job.updated_at = new Date().toISOString();
}

export function moveBgJobToDlqFallback(companyId: string, jobId: string, lastError: string) {
  const companyJobs = getJobs(companyId);
  const index = companyJobs.findIndex((item) => item.id === jobId);
  if (index < 0) return;
  const [job] = companyJobs.splice(index, 1);
  getDlq(companyId).push({
    id: crypto.randomUUID(),
    bg_job_id: job.id,
    type: job.type,
    company_id: companyId,
    payload: job.payload,
    attempts: job.attempts,
    last_error: lastError,
    failed_at: new Date().toISOString(),
  });
}

export function listBgJobsDlqFallback(companyId: string, limit: number): BgJobDlqRecord[] {
  return getDlq(companyId)
    .slice()
    .sort((a, b) => (a.failed_at < b.failed_at ? 1 : -1))
    .slice(0, limit);
}
