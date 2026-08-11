import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES,
  MAX_VIDEO_ATTACHMENT_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  validateMessageAttachmentTotalSize,
  validateVideoAttachmentPolicy,
  inferVideoAttachmentContentType,
} from "../../src/lib/messages/attachmentPolicy.ts";
import {
  MESSAGE_UPLOAD_RETRY_DELAYS_MS,
  SUPABASE_TUS_CHUNK_BYTES,
  buildSupabaseResumableEndpoint,
  uploadAttachmentWithProgress,
} from "../../src/lib/messages/videoClient.ts";
import { buildMessagePushContent } from "../../src/lib/push/domain.ts";
import { validateAttachmentMetadata } from "../../src/lib/attachments/security.ts";
import {
  attachmentsForMessages,
  persistMessageAttachments,
  validateMessageFileMeta,
  type MessageAttachmentInput,
} from "../../src/lib/messages/attachments.ts";

function video(overrides: Partial<{
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
}> = {}) {
  return {
    fileName: "walkthrough.mp4",
    contentType: "video/mp4",
    sizeBytes: 4 * 1024 * 1024,
    durationSeconds: 12,
    ...overrides,
  };
}

function validationError(result: { ok: true } | { ok: false; error: string }): string {
  assert.equal(result.ok, false);
  return (result as { ok: false; error: string }).error;
}

function attachmentDbFixture(
  objects: Record<string, { size: number; contentType: string }>
) {
  let storedRows: Array<Record<string, unknown>> = [];
  const removedPaths: string[] = [];
  const bucket = {
    async createSignedUrl(path: string) {
      if (!objects[path]) return { data: null, error: { message: "not found" } };
      return { data: { signedUrl: `https://private.example/${path}?token=short-lived` }, error: null };
    },
    async info(path: string) {
      const object = objects[path];
      return object
        ? { data: object, error: null }
        : { data: null, error: { message: "not found" } };
    },
    async remove(paths: string[]) {
      removedPaths.push(...paths);
      return { data: paths, error: null };
    },
  };

  const table = {
    insert(rows: Array<Record<string, unknown>>) {
      storedRows = rows.map((row, index) => ({ ...row, id: `attachment-${index + 1}`, created_at: "now" }));
      return {
        select: async () => ({ data: storedRows, error: null }),
      };
    },
    select() {
      return table;
    },
    eq() {
      return table;
    },
    async in() {
      return { data: storedRows, error: null };
    },
  };

  return {
    db: {
      storage: { from: () => bucket },
      from: (name: string) => {
        assert.equal(name, "message_attachments");
        return table;
      },
    },
    removedPaths,
    storedRows: () => storedRows,
  };
}

test("short MP4, MOV, M4V, and WebM videos pass the message policy", () => {
  assert.equal(MAX_VIDEO_ATTACHMENT_BYTES, 250 * 1024 * 1024);
  assert.equal(MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES, 100 * 1024 * 1024);
  assert.equal(MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES, 500 * 1024 * 1024);
  assert.equal(validateVideoAttachmentPolicy(video()).ok, true);
  assert.equal(
    validateVideoAttachmentPolicy(video({ fileName: "site.mov", contentType: "video/quicktime" })).ok,
    true
  );
  assert.equal(inferVideoAttachmentContentType("ios-export.MOV", ""), "video/quicktime");
  assert.equal(
    validateVideoAttachmentPolicy(video({ fileName: "site.m4v", contentType: "video/x-m4v" })).ok,
    true
  );
  assert.equal(
    validateVideoAttachmentPolicy(video({ fileName: "site.webm", contentType: "video/webm" })).ok,
    true
  );
});

test("unsupported, mismatched, oversized, and over-duration videos fail cleanly", () => {
  assert.match(
    validationError(validateVideoAttachmentPolicy(video({ fileName: "site.avi", contentType: "video/x-msvideo" }))),
    /not supported/i
  );
  assert.match(
    validationError(validateVideoAttachmentPolicy(video({ fileName: "site.webm", contentType: "video/mp4" }))),
    /does not match/i
  );
  assert.match(
    validationError(validateVideoAttachmentPolicy(video({ sizeBytes: MAX_VIDEO_ATTACHMENT_BYTES + 1 }))),
    /larger than 250 MB/i
  );
  assert.match(
    validationError(validateVideoAttachmentPolicy(video({ durationSeconds: MAX_VIDEO_DURATION_SECONDS + 0.01 }))),
    /longer than 10 minutes/i
  );
});

test("mixed image and video attachments share a bounded total message size", () => {
  assert.equal(
    validateMessageAttachmentTotalSize([
      { file_size: 4 * 1024 * 1024 },
      { file_size: 20 * 1024 * 1024 },
      { file_size: 20 * 1024 * 1024 },
    ]).ok,
    true
  );
  assert.match(
    validationError(validateMessageAttachmentTotalSize([
      { file_size: MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES },
      { file_size: 1 },
    ])),
    /500 MB/i
  );
});

test("message files accept practical business sizes while retaining an individual cap", () => {
  assert.equal(
    validateMessageFileMeta({
      file_name: "project-manual.pdf",
      content_type: "application/pdf",
      file_size: 80 * 1024 * 1024,
    }).ok,
    true
  );
  assert.match(
    validationError(validateMessageFileMeta({
      file_name: "project-manual.pdf",
      content_type: "application/pdf",
      file_size: MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES + 1,
    })),
    /too large/i
  );
});

test("existing image and file attachment policy stays unchanged", () => {
  assert.equal(
    validateAttachmentMetadata({
      fileName: "jobsite.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2 * 1024 * 1024,
    }).ok,
    true
  );
  assert.equal(
    validateAttachmentMetadata({
      fileName: "scope.pdf",
      contentType: "application/pdf",
      sizeBytes: 2 * 1024 * 1024,
    }).ok,
    true
  );
  assert.equal(
    validateAttachmentMetadata({
      fileName: "video.mp4",
      contentType: "video/mp4",
      sizeBytes: 2 * 1024 * 1024,
    }).ok,
    false,
    "generic document uploads do not silently gain video support"
  );
});

test("a mixed image and video batch persists and reloads with fresh private URLs", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const imagePath = `${companyId}/messages/photo.jpg`;
  const videoPath = `${companyId}/messages/walkthrough.mp4`;
  const fixture = attachmentDbFixture({
    [imagePath]: { size: 2_000, contentType: "image/jpeg" },
    [videoPath]: { size: 4_000, contentType: "video/mp4" },
  });
  const attachments: MessageAttachmentInput[] = [
    {
      path: imagePath,
      file_name: "photo.jpg",
      content_type: "image/jpeg",
      file_size: 2_000,
    },
    {
      path: videoPath,
      file_name: "walkthrough.mp4",
      content_type: "video/mp4",
      file_size: 4_000,
      duration_seconds: 14,
    },
  ];

  const persisted = await persistMessageAttachments({
    db: fixture.db,
    companyId,
    threadId: "22222222-2222-4222-8222-222222222222",
    messageId: "33333333-3333-4333-8333-333333333333",
    uploaderId: "44444444-4444-4444-8444-444444444444",
    attachments,
  });
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].is_image, true);
  assert.equal(persisted[1].is_video, true);
  assert.match(String(persisted[1].download_url), /token=short-lived/);

  const reloaded = await attachmentsForMessages(
    fixture.db,
    companyId,
    ["33333333-3333-4333-8333-333333333333"]
  );
  const rows = reloaded.get("33333333-3333-4333-8333-333333333333") ?? [];
  assert.equal(rows.length, 2);
  assert.equal(rows[1].is_video, true);
  assert.match(String(rows[1].download_url), /token=short-lived/);
});

test("foreign-company and incomplete uploads are rejected without a message attachment row", async () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const foreign = attachmentDbFixture({});
  await assert.rejects(
    persistMessageAttachments({
      db: foreign.db,
      companyId,
      threadId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      uploaderId: "44444444-4444-4444-8444-444444444444",
      attachments: [{
        path: "99999999-9999-4999-8999-999999999999/messages/video.mp4",
        file_name: "video.mp4",
        content_type: "video/mp4",
        file_size: 4_000,
        duration_seconds: 14,
      }],
    }),
    /Invalid attachment path/
  );
  assert.equal(foreign.storedRows().length, 0);

  const path = `${companyId}/messages/incomplete.mp4`;
  const incomplete = attachmentDbFixture({
    [path]: { size: 3_999, contentType: "video/mp4" },
  });
  await assert.rejects(
    persistMessageAttachments({
      db: incomplete.db,
      companyId,
      threadId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      uploaderId: "44444444-4444-4444-8444-444444444444",
      attachments: [{
        path,
        file_name: "incomplete.mp4",
        content_type: "video/mp4",
        file_size: 4_000,
        duration_seconds: 14,
      }],
    }),
    /incomplete or has an unexpected size/
  );
  assert.deepEqual(incomplete.removedPaths, [path]);
  assert.equal(incomplete.storedRows().length, 0);
});

test("signed TUS upload uses direct Storage, fixed chunks, progress, and resumable retry", async () => {
  const progress: number[] = [];
  type TestTusOptions = {
    endpoint?: string | null;
    chunkSize?: number;
    retryDelays?: number[] | null;
    headers?: Record<string, string>;
    metadata?: Record<string, string>;
    onProgress?: (uploaded: number, total: number) => void;
    onSuccess?: () => void;
  };
  let options: TestTusOptions = {};
  let resumed = false;

  await uploadAttachmentWithProgress({
    supabaseUrl: "https://example.supabase.co",
    bucket: "message-attachments",
    path: "company/messages/video.mp4",
    token: "short-lived-signed-token",
    file: { name: "walkthrough.mp4", size: 10, lastModified: 123 } as File,
    contentType: "video/mp4",
    headers: { apikey: "public-anon-key" },
    onProgress: (value) => progress.push(value),
    createUpload: (_file, uploadOptions) => {
      options = uploadOptions as unknown as TestTusOptions;
      return {
        abort: async () => undefined,
        findPreviousUploads: async () => [{
          size: 10,
          metadata: {},
          creationTime: "now",
          urlStorageKey: "resume-key",
          uploadUrl: "https://resume.example/upload",
          parallelUploadUrls: null,
        }],
        resumeFromPreviousUpload: () => { resumed = true; },
        start: () => {
          options.onProgress?.(4, 10);
          options.onSuccess?.();
        },
      };
    },
  });

  assert.deepEqual(progress, [40, 100]);
  assert.equal(resumed, true);
  assert.equal(options.endpoint, "https://example.storage.supabase.co/storage/v1/upload/resumable/sign");
  assert.equal(options.chunkSize, SUPABASE_TUS_CHUNK_BYTES);
  assert.deepEqual(options.retryDelays, MESSAGE_UPLOAD_RETRY_DELAYS_MS);
  assert.equal(options.headers?.["x-signature"], "short-lived-signed-token");
  assert.equal(options.headers?.["x-upsert"], "false");
  assert.equal(options.headers?.apikey, "public-anon-key");
  assert.equal(options.metadata?.bucketName, "message-attachments");
  assert.equal(options.metadata?.objectName, "company/messages/video.mp4");
});

test("upload failures terminate partial data and reject before a message can be created", async () => {
  let terminated = false;
  await assert.rejects(
    uploadAttachmentWithProgress({
      supabaseUrl: "https://example.supabase.co",
      bucket: "message-attachments",
      path: "company/messages/video.mp4",
      token: "signed-token",
      file: { name: "too-large.mp4", size: 10, lastModified: 123 } as File,
      contentType: "video/mp4",
      createUpload: (_file, options) => ({
        abort: async (shouldTerminate) => { terminated = Boolean(shouldTerminate); },
        findPreviousUploads: async () => [],
        resumeFromPreviousUpload: () => undefined,
        start: () => options.onError?.(new Error("mobile network unavailable")),
      }),
    }),
    /mobile network unavailable/
  );
  assert.equal(terminated, true);
  assert.equal(buildSupabaseResumableEndpoint("http://localhost:54321"), "http://localhost:54321/storage/v1/upload/resumable/sign");
  assert.throws(() => buildSupabaseResumableEndpoint("http://attacker.example"), /HTTPS/);
});

test("video message push previews contain no media URL or storage metadata", () => {
  const content = buildMessagePushContent({
    senderName: "Jaden Smith",
    messageBody: "",
    attachmentCount: 1,
  });
  assert.deepEqual(content, {
    title: "New message from Jaden Smith",
    body: "Sent an attachment",
  });
  assert.doesNotMatch(JSON.stringify(content), /https?:|storage_path|signed/i);
});

test("UI and API retain private, participant-scoped attachment behavior", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(join(repoRoot, "app/components/views/MessagesView.tsx"), "utf8");
  const signRoute = readFileSync(
    join(repoRoot, "app/api/messages/threads/[id]/attachments/sign/route.ts"),
    "utf8"
  );
  const messageRoute = readFileSync(
    join(repoRoot, "app/api/messages/threads/[id]/messages/route.ts"),
    "utf8"
  );
  const attachmentDomain = readFileSync(join(repoRoot, "src/lib/messages/attachments.ts"), "utf8");
  const uploadClient = readFileSync(join(repoRoot, "src/lib/messages/videoClient.ts"), "utf8");
  const pushWorker = readFileSync(join(repoRoot, "src/lib/push/worker.ts"), "utf8");

  assert.match(view, /accept="[^"]*video\/mp4[^"]*video\/quicktime[^"]*video\/webm/);
  assert.match(view, /<video[\s\S]*controls[\s\S]*playsInline[\s\S]*preload="metadata"/);
  assert.match(view, /uploadAttachmentWithProgress/);
  assert.match(view, /role="progressbar"/);
  assert.match(view, /messages-attachment-retry-/);
  assert.match(view, /keepalive: true/);
  assert.match(view, /#t=0\.001/);
  assert.match(view, /max-w-\[20rem\]/);
  assert.ok(view.indexOf("await uploadAttachmentWithProgress") < view.indexOf("/send`"));
  assert.match(signRoute, /getThreadIfParticipant/);
  assert.match(signRoute, /if \(!participant \|\| !thread\) return forbidden\(\)/);
  assert.match(signRoute, /export async function DELETE/);
  assert.match(signRoute, /isCompanyScopedMessagePath\(companyId, path\)/);
  assert.match(signRoute, /from\("message_attachments"\)[\s\S]*in\("storage_path", parsed\.data\.paths\)/);
  assert.match(messageRoute, /if \(!participant\)/);
  assert.match(messageRoute, /attachmentsForMessages/);
  assert.match(attachmentDomain, /MESSAGE_ATTACHMENTS_BUCKET = "message-attachments"/);
  assert.match(attachmentDomain, /createSignedUrl/);
  assert.doesNotMatch(attachmentDomain, /getPublicUrl/);
  assert.match(attachmentDomain, /actualSize !== Number\(attachment\.file_size\)/);
  assert.match(uploadClient, /chunkSize: SUPABASE_TUS_CHUNK_BYTES/);
  assert.match(uploadClient, /"x-signature": input\.token/);
  assert.match(uploadClient, /upload\.abort\(true\)/);
  assert.match(pushWorker, /from\("message_attachments"\)[\s\S]{0,100}select\("id", \{ count: "exact", head: true \}\)/);
  assert.doesNotMatch(pushWorker, /select\([^\n]*(storage_path|download_url|signedDownloadUrl)/);
});
