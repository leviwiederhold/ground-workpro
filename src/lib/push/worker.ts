import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMessagePushContent,
  getPushRetryAt,
  selectEligiblePushDevices,
  type PushDeviceCandidate,
} from "@/lib/push/domain";
import { sendMessagePushToDevice } from "@/lib/push/provider";
import { resolveDisplayNames } from "@/lib/messages/mvp";

type PushJob = {
  id: string;
  company_id: string;
  message_id: string;
  thread_id: string;
  sender_user_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
};

type DeliveryAttempt = {
  push_device_id: string | null;
  status: "sent" | "invalid_token" | "failed" | "unsupported";
};

export async function enqueueMessagePushJob(input: {
  db: SupabaseClient;
  companyId: string;
  messageId: string;
  threadId: string;
  senderUserId: string;
}) {
  const { data, error } = await input.db
    .from("message_push_jobs")
    .upsert(
      {
        company_id: input.companyId,
        message_id: input.messageId,
        thread_id: input.threadId,
        sender_user_id: input.senderUserId,
        status: "queued",
        run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to enqueue message push");
  return data;
}

async function updateJob(
  db: SupabaseClient,
  jobId: string,
  payload: Record<string, unknown>
) {
  const { error } = await db
    .from("message_push_jobs")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
}

async function recordDeliveryAttempt(input: {
  db: SupabaseClient;
  job: PushJob;
  device: PushDeviceCandidate;
  status: DeliveryAttempt["status"];
  providerStatus?: number | null;
  providerId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const now = new Date().toISOString();
  const existing = await input.db
    .from("message_push_delivery_attempts")
    .select("id, attempt_count")
    .eq("job_id", input.job.id)
    .eq("push_device_id", input.device.id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const { error } = await input.db.from("message_push_delivery_attempts").upsert(
    {
      id: existing.data?.id,
      job_id: input.job.id,
      push_device_id: input.device.id,
      company_id: input.job.company_id,
      user_id: input.device.user_id,
      platform: input.device.platform,
      status: input.status,
      attempt_count: Number(existing.data?.attempt_count ?? 0) + 1,
      provider_status: input.providerStatus ?? null,
      provider_id: input.providerId ?? null,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage?.slice(0, 500) ?? null,
      updated_at: now,
    },
    { onConflict: "job_id,push_device_id" }
  );
  if (error) throw new Error(error.message);
}

async function updateDeviceAfterDelivery(input: {
  db: SupabaseClient;
  device: PushDeviceCandidate & { failure_count?: number };
  outcome: "sent" | "invalid" | "failed";
  reason?: string | null;
}) {
  const now = new Date().toISOString();
  const payload =
    input.outcome === "sent"
      ? { failure_count: 0, last_failure_at: null, last_seen_at: now, updated_at: now }
      : input.outcome === "invalid"
        ? {
            enabled: false,
            revoked_at: now,
            revoked_reason: input.reason || "provider_invalid_token",
            failure_count: Number(input.device.failure_count ?? 0) + 1,
            last_failure_at: now,
            updated_at: now,
          }
        : {
            failure_count: Number(input.device.failure_count ?? 0) + 1,
            last_failure_at: now,
            updated_at: now,
          };

  await input.db.from("push_devices").update(payload).eq("id", input.device.id);
}

async function processJob(db: SupabaseClient, job: PushJob) {
  const messageResult = await db
    .from("messages")
    .select("id, company_id, thread_id, sender_user_id, body")
    .eq("id", job.message_id)
    .eq("company_id", job.company_id)
    .eq("thread_id", job.thread_id)
    .maybeSingle();
  if (messageResult.error) throw new Error(messageResult.error.message);
  if (!messageResult.data || String(messageResult.data.sender_user_id) !== String(job.sender_user_id)) {
    await updateJob(db, job.id, {
      status: "failed",
      processed_at: new Date().toISOString(),
      last_error: "Message no longer matches queued push job",
    });
    return { sent: 0, invalid: 0, failed: 1, skipped: 0 };
  }

  const participantsResult = await db
    .from("message_participants")
    .select("user_id")
    .eq("company_id", job.company_id)
    .eq("thread_id", job.thread_id);
  if (participantsResult.error) throw new Error(participantsResult.error.message);
  const participantUserIds = Array.from(
    new Set((participantsResult.data ?? []).map((row) => String(row.user_id)).filter(Boolean))
  );
  const possibleRecipients = participantUserIds.filter(
    (userId) => userId !== String(job.sender_user_id)
  );

  const membershipsResult = possibleRecipients.length
    ? await db
        .from("memberships")
        .select("user_id")
        .eq("company_id", job.company_id)
        .in("user_id", possibleRecipients)
    : { data: [], error: null };
  if (membershipsResult.error) throw new Error(membershipsResult.error.message);
  const activeMemberUserIds = (membershipsResult.data ?? []).map((row) => String(row.user_id));

  const devicesResult = activeMemberUserIds.length
    ? await db
        .from("push_devices")
        .select(
          "id, company_id, user_id, platform, device_id, push_token, push_environment, enabled, revoked_at, failure_count"
        )
        .eq("company_id", job.company_id)
        .eq("enabled", true)
        .in("user_id", activeMemberUserIds)
    : { data: [], error: null };
  if (devicesResult.error) throw new Error(devicesResult.error.message);

  const devices = selectEligiblePushDevices({
    companyId: job.company_id,
    senderUserId: job.sender_user_id,
    participantUserIds,
    activeMemberUserIds,
    devices: (devicesResult.data ?? []) as PushDeviceCandidate[],
  });

  if (devices.length === 0) {
    await updateJob(db, job.id, {
      status: "completed",
      processed_at: new Date().toISOString(),
      last_error: null,
    });
    return { sent: 0, invalid: 0, failed: 0, skipped: 0 };
  }

  const attemptsResult = await db
    .from("message_push_delivery_attempts")
    .select("push_device_id, status")
    .eq("job_id", job.id);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  const terminalDeviceIds = new Set(
    ((attemptsResult.data ?? []) as DeliveryAttempt[])
      .filter((attempt) => ["sent", "invalid_token", "unsupported"].includes(attempt.status))
      .map((attempt) => String(attempt.push_device_id ?? ""))
      .filter(Boolean)
  );

  const [displayNames, attachmentsResult] = await Promise.all([
    resolveDisplayNames(db, job.company_id, [job.sender_user_id]),
    db
      .from("message_attachments")
      .select("id", { count: "exact", head: true })
      .eq("company_id", job.company_id)
      .eq("message_id", job.message_id),
  ]);
  const content = buildMessagePushContent({
    senderName: displayNames.get(job.sender_user_id) || "Team Member",
    messageBody: String(messageResult.data.body ?? ""),
    attachmentCount: Number(attachmentsResult.count ?? 0),
  });

  let sent = 0;
  let invalid = 0;
  let failed = 0;
  let skipped = 0;
  let retryableFailures = 0;

  for (const device of devices) {
    if (terminalDeviceIds.has(device.id)) {
      skipped += 1;
      continue;
    }

    try {
      const result = await sendMessagePushToDevice({
        device,
        title: content.title,
        body: content.body,
        threadId: job.thread_id,
        messageId: job.message_id,
      });

      if (result.ok) {
        sent += 1;
        await recordDeliveryAttempt({
          db,
          job,
          device,
          status: "sent",
          providerStatus: result.status,
          providerId: result.providerId,
        });
        await updateDeviceAfterDelivery({ db, device, outcome: "sent" });
      } else if (result.invalidToken) {
        invalid += 1;
        await recordDeliveryAttempt({
          db,
          job,
          device,
          status: "invalid_token",
          providerStatus: result.status,
          providerId: result.providerId,
          errorCode: result.reason,
          errorMessage: result.reason,
        });
        await updateDeviceAfterDelivery({
          db,
          device,
          outcome: "invalid",
          reason: result.reason,
        });
      } else {
        failed += 1;
        if (result.retryable) retryableFailures += 1;
        await recordDeliveryAttempt({
          db,
          job,
          device,
          status: "failed",
          providerStatus: result.status,
          providerId: result.providerId,
          errorCode: result.reason,
          errorMessage: result.reason,
        });
        await updateDeviceAfterDelivery({ db, device, outcome: "failed" });
      }
    } catch (error) {
      failed += 1;
      retryableFailures += 1;
      const message = error instanceof Error ? error.message : "Push provider failed";
      await recordDeliveryAttempt({
        db,
        job,
        device,
        status: "failed",
        errorCode: "ProviderError",
        errorMessage: message,
      });
      await updateDeviceAfterDelivery({ db, device, outcome: "failed" });
    }
  }

  if (retryableFailures > 0 && job.attempts < job.max_attempts) {
    await updateJob(db, job.id, {
      status: "queued",
      run_at: getPushRetryAt(job.attempts),
      processed_at: null,
      last_error: `${retryableFailures} push delivery attempt(s) will retry`,
    });
  } else {
    await updateJob(db, job.id, {
      status: retryableFailures > 0 ? "failed" : "completed",
      processed_at: new Date().toISOString(),
      last_error: retryableFailures > 0 ? `${retryableFailures} push delivery attempt(s) failed` : null,
    });
  }

  return { sent, invalid, failed, skipped };
}

export async function processPushNotificationJobs(input: {
  db: SupabaseClient;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100));
  const claimedResult = await input.db.rpc("claim_message_push_jobs", { p_limit: limit });
  if (claimedResult.error) throw new Error(claimedResult.error.message);

  const jobs = (claimedResult.data ?? []) as PushJob[];
  const totals = { claimed: jobs.length, completed: 0, retried: 0, failed: 0, sent: 0, invalid: 0, skipped: 0 };

  for (const job of jobs) {
    try {
      const outcome = await processJob(input.db, job);
      totals.sent += outcome.sent;
      totals.invalid += outcome.invalid;
      totals.failed += outcome.failed;
      totals.skipped += outcome.skipped;

      const statusResult = await input.db
        .from("message_push_jobs")
        .select("status")
        .eq("id", job.id)
        .maybeSingle();
      if (statusResult.data?.status === "queued") totals.retried += 1;
      else if (statusResult.data?.status === "failed") totals.failed += 1;
      else totals.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push job failed";
      const canRetry = job.attempts < job.max_attempts;
      await updateJob(input.db, job.id, {
        status: canRetry ? "queued" : "failed",
        run_at: canRetry ? getPushRetryAt(job.attempts) : new Date().toISOString(),
        processed_at: canRetry ? null : new Date().toISOString(),
        last_error: message.slice(0, 500),
      });
      if (canRetry) totals.retried += 1;
      else totals.failed += 1;
    }
  }

  return totals;
}
