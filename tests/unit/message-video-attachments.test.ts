import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  MAX_VIDEO_ATTACHMENT_BYTES,
  validateMessageAttachmentTotalSize,
  validateVideoAttachmentPolicy,
  inferVideoAttachmentContentType,
} from "../../src/lib/messages/attachmentPolicy.ts";
import { uploadAttachmentWithProgress } from "../../src/lib/messages/videoClient.ts";
import { buildMessagePushContent } from "../../src/lib/push/domain.ts";
import { validateAttachmentMetadata } from "../../src/lib/attachments/security.ts";
import {
  attachmentsForMessages,
  persistMessageAttachments,
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

type MockUploadRequest = {
  upload: { onprogress?: (event: ProgressEvent) => void };
  status: number;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  open: (method: string, url: string, async?: boolean) => void;
  setRequestHeader: (name: string, value: string) => void;
  send: (file: unknown) => void;
};

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
    /larger than 25 MB/i
  );
  assert.match(
    validationError(validateVideoAttachmentPolicy(video({ durationSeconds: 60.01 }))),
    /longer than 60 seconds/i
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
    /50 MB/i
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

test("signed upload reports progress and resolves only after provider success", async () => {
  const progress: number[] = [];
  const headers = new Map<string, string>();
  const request: MockUploadRequest = {
    upload: {},
    status: 0,
    open(method: string, url: string) {
      assert.equal(method, "PUT");
      assert.match(url, /\/storage\/v1\/object\/upload\/sign\//);
    },
    setRequestHeader(name: string, value: string) {
      headers.set(name, value);
    },
    send(file: unknown) {
      assert.ok(file);
      request.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 10 } as ProgressEvent);
      request.status = 200;
      request.onload?.();
    },
  };

  await uploadAttachmentWithProgress({
    signedUrl: "https://example.supabase.co/storage/v1/object/upload/sign/message-attachments/video?token=signed",
    file: { name: "walkthrough.mp4" } as File,
    contentType: "video/mp4",
    headers: { authorization: "Bearer test-session", apikey: "public-anon-key" },
    allowedOrigin: "https://example.supabase.co",
    onProgress: (value) => progress.push(value),
    createRequest: () => request as unknown as XMLHttpRequest,
  });

  assert.deepEqual(progress, [40, 100]);
  assert.equal(headers.get("content-type"), "video/mp4");
  assert.equal(headers.get("x-upsert"), "false");
  assert.equal(headers.get("authorization"), "Bearer test-session");
  assert.equal(headers.get("apikey"), "public-anon-key");
});

test("upload failures reject before a message can be created", async () => {
  const request: MockUploadRequest = {
    upload: {},
    status: 413,
    open() {},
    setRequestHeader() {},
    send() {
      request.onload?.();
    },
  };
  await assert.rejects(
    uploadAttachmentWithProgress({
      signedUrl: "https://example.supabase.co/storage/v1/object/upload/sign/message-attachments/video?token=signed",
      file: { name: "too-large.mp4" } as File,
      contentType: "video/mp4",
      createRequest: () => request as unknown as XMLHttpRequest,
    }),
    /Upload failed \(413\)/
  );
  await assert.rejects(
    uploadAttachmentWithProgress({
      signedUrl: "https://attacker.example/upload",
      file: { name: "walkthrough.mp4" } as File,
      contentType: "video/mp4",
      allowedOrigin: "https://example.supabase.co",
      createRequest: () => request as unknown as XMLHttpRequest,
    }),
    /does not match the configured storage service/
  );
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
  const pushWorker = readFileSync(join(repoRoot, "src/lib/push/worker.ts"), "utf8");

  assert.match(view, /accept="[^"]*video\/mp4[^"]*video\/quicktime[^"]*video\/webm/);
  assert.match(view, /<video[\s\S]*controls[\s\S]*playsInline[\s\S]*preload="metadata"/);
  assert.match(view, /uploadAttachmentWithProgress/);
  assert.match(view, /role="progressbar"/);
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
  assert.match(pushWorker, /from\("message_attachments"\)[\s\S]{0,100}select\("id", \{ count: "exact", head: true \}\)/);
  assert.doesNotMatch(pushWorker, /select\([^\n]*(storage_path|download_url|signedDownloadUrl)/);
});
