const MEBIBYTE_BYTES = 1024 * 1024;

// Single application-level switch for the largest message attachment. Keep
// this below the live Supabase global Storage limit. When the project moves off
// the Free plan, raising this value and the private bucket limit is sufficient;
// the signed, resumable TUS upload architecture does not need to change.
export const MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB = 45;
export const MAX_MESSAGE_ATTACHMENT_BYTES = MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB * MEBIBYTE_BYTES;
export const MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES = MAX_MESSAGE_ATTACHMENT_BYTES;
export const MAX_VIDEO_ATTACHMENT_BYTES = MAX_MESSAGE_ATTACHMENT_BYTES;
export const MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES = MAX_MESSAGE_ATTACHMENT_BYTES * 10;
export const MAX_VIDEO_DURATION_SECONDS = 10 * 60;

export const messageAttachmentSizeError = (label = "Attachment") =>
  `${label} is larger than ${MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB} MiB`;

export const VIDEO_ATTACHMENT_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

export const VIDEO_ATTACHMENT_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);

const VIDEO_EXTENSIONS_BY_CONTENT_TYPE: Record<string, Set<string>> = {
  "video/mp4": new Set(["m4v", "mov", "mp4"]),
  "video/quicktime": new Set(["mov"]),
  "video/webm": new Set(["webm"]),
  "video/x-m4v": new Set(["m4v"]),
};

const DEFAULT_VIDEO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function normalizeAttachmentContentType(value: string): string {
  return String(value ?? "").toLowerCase().split(";")[0].trim();
}

export function attachmentFileExtension(fileName: string): string {
  return String(fileName ?? "").trim().split(".").pop()?.toLowerCase() ?? "";
}

export function isVideoAttachmentContentType(contentType: string | null | undefined): boolean {
  return normalizeAttachmentContentType(String(contentType ?? "")).startsWith("video/");
}

export function inferVideoAttachmentContentType(fileName: string, contentType: string): string {
  const normalized = normalizeAttachmentContentType(contentType);
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return DEFAULT_VIDEO_CONTENT_TYPE_BY_EXTENSION[attachmentFileExtension(fileName)] ?? normalized;
}

export function validateVideoAttachmentPolicy(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
}): { ok: true; contentType: string; durationSeconds: number } | { ok: false; error: string } {
  const contentType = normalizeAttachmentContentType(input.contentType);
  const extension = attachmentFileExtension(input.fileName);
  const allowedExtensions = VIDEO_EXTENSIONS_BY_CONTENT_TYPE[contentType];

  if (!VIDEO_ATTACHMENT_TYPES.has(contentType) || !VIDEO_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { ok: false, error: "Video format is not supported. Use MP4, MOV, M4V, or WebM" };
  }
  if (!allowedExtensions?.has(extension)) {
    return { ok: false, error: "Video file extension does not match its content type" };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "Invalid file size" };
  }
  if (input.sizeBytes > MAX_VIDEO_ATTACHMENT_BYTES) {
    return { ok: false, error: messageAttachmentSizeError("Video") };
  }

  const durationSeconds = Number(input.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, error: "Could not read the video duration" };
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return { ok: false, error: "Video is longer than 10 minutes" };
  }

  return { ok: true, contentType, durationSeconds };
}

export function validateMessageAttachmentTotalSize(
  files: Array<{ file_size?: number; size?: number }>
): { ok: true } | { ok: false; error: string } {
  const totalBytes = files.reduce(
    (sum, file) => sum + Number(file.file_size ?? file.size ?? 0),
    0
  );
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { ok: false, error: "Invalid attachment size" };
  }
  if (totalBytes > MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Attachments exceed the ${MESSAGE_ATTACHMENT_SIZE_LIMIT_MIB * 10} MiB total message limit`,
    };
  }
  return { ok: true };
}
