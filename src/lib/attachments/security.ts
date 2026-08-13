import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "txt",
  "webp",
  "xls",
  "xlsx",
]);

export const fileSizeSchema = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0, "file size must be positive")
  .refine((value) => value <= MAX_ATTACHMENT_BYTES, "file is too large");

export const sanitizeAttachmentFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);

export const validateAttachmentMetadata = ({
  fileName,
  contentType,
  sizeBytes,
  maxBytes = MAX_ATTACHMENT_BYTES,
}: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  maxBytes?: number;
}) => {
  const safeFileName = sanitizeAttachmentFileName(fileName);
  const extension = safeFileName.split(".").pop()?.toLowerCase() ?? "";
  const normalizedContentType = contentType.toLowerCase().split(";")[0].trim();

  if (!safeFileName || safeFileName === "." || safeFileName === "..") {
    return { ok: false as const, error: "Invalid file name" };
  }

  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { ok: false as const, error: "File type is not allowed" };
  }

  if (!ALLOWED_ATTACHMENT_TYPES.has(normalizedContentType)) {
    return { ok: false as const, error: "Content type is not allowed" };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false as const, error: "Invalid file size" };
  }

  if (sizeBytes > maxBytes) {
    return { ok: false as const, error: "File is too large" };
  }

  return {
    ok: true as const,
    safeFileName,
    contentType: normalizedContentType,
    sizeBytes,
  };
};

export const assertCompanyScopedStoragePath = (companyId: string, path: string) => {
  const prefix = `${companyId}/`;
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("//");
};

export const getServerAttachmentBucket = () =>
  process.env.SUPABASE_ATTACHMENTS_BUCKET || "attachments";
