/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import {
  sanitizeAttachmentFileName,
  validateAttachmentMetadata,
} from "../attachments/security.ts";
import {
  MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES,
  isVideoAttachmentContentType,
  validateMessageAttachmentTotalSize,
  validateVideoAttachmentPolicy,
} from "./attachmentPolicy.ts";

export const MESSAGE_ATTACHMENTS_BUCKET = "message-attachments";
export const MAX_MESSAGE_ATTACHMENTS = 10;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type MessageAttachmentInput = {
  path: string;
  file_name: string;
  content_type: string;
  file_size: number;
  duration_seconds?: number;
};

// Validate a single file's METADATA (name/type/size) against the shared
// attachment security allowlist — rejects executables/dangerous types and files
// over the size cap. Used before issuing an upload URL and again when the
// message is sent (defense in depth), since bytes upload directly to Storage.
export function validateMessageFileMeta(input: {
  file_name: string;
  content_type: string;
  file_size: number;
  duration_seconds?: number;
}):
  | { ok: true; safeFileName: string; contentType: string; durationSeconds?: number }
  | { ok: false; error: string } {
  const safeFileName = sanitizeAttachmentFileName(input.file_name || "upload.bin");
  if (isVideoAttachmentContentType(input.content_type)) {
    const videoValidation = validateVideoAttachmentPolicy({
      fileName: safeFileName,
      contentType: input.content_type,
      sizeBytes: Number(input.file_size),
      durationSeconds: input.duration_seconds,
    });
    if (!videoValidation.ok) return videoValidation;
    return {
      ok: true,
      safeFileName,
      contentType: videoValidation.contentType,
      durationSeconds: videoValidation.durationSeconds,
    };
  }
  const validation = validateAttachmentMetadata({
    fileName: input.file_name || "upload.bin",
    contentType: input.content_type || "application/octet-stream",
    sizeBytes: Number(input.file_size),
    maxBytes: MAX_STANDARD_MESSAGE_ATTACHMENT_BYTES,
  });
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, safeFileName: validation.safeFileName, contentType: validation.contentType };
}

// Company-scoped storage path for a message attachment. Bytes upload directly
// from the browser via a signed upload URL, so the path is generated server-side
// and always carries the company prefix used by the send-time ownership check.
export function buildMessageAttachmentPath(companyId: string, safeFileName: string): string {
  const extMatch = safeFileName.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : "";
  return `${companyId}/messages/${randomUUID()}${ext}`;
}

export function isCompanyScopedMessagePath(companyId: string, path: string): boolean {
  const prefix = `${companyId}/messages/`;
  return typeof path === "string" && path.startsWith(prefix) && !path.includes("..") && !path.includes("//");
}

export function isImageContentType(contentType: string | null | undefined): boolean {
  return String(contentType ?? "").toLowerCase().startsWith("image/");
}

export function isVideoContentType(contentType: string | null | undefined): boolean {
  return isVideoAttachmentContentType(contentType);
}

export function mapMessageAttachment(row: any, signedUrl: string | null = null) {
  return {
    id: row.id,
    message_id: row.message_id ?? null,
    thread_id: row.thread_id ?? null,
    uploader_id: row.uploader_id ?? null,
    file_name: row.file_name ?? "",
    content_type: row.content_type ?? "application/octet-stream",
    file_size: Number(row.file_size ?? 0),
    is_image: isImageContentType(row.content_type),
    is_video: isVideoContentType(row.content_type),
    bucket: row.storage_bucket ?? MESSAGE_ATTACHMENTS_BUCKET,
    path: row.storage_path ?? "",
    created_at: row.created_at ?? "",
    download_url: signedUrl,
    signedDownloadUrl: signedUrl,
  };
}

// Persist attachment rows for a just-created message. Bytes were already
// uploaded DIRECTLY to Storage by the browser (via a signed upload URL), so this
// only validates ownership + metadata, confirms each object exists, and inserts
// the rows. On any failure the referenced objects are removed and an error is
// thrown so the caller can roll back the message.
export async function persistMessageAttachments(params: {
  db: any;
  companyId: string;
  threadId: string;
  messageId: string;
  uploaderId: string;
  attachments: MessageAttachmentInput[];
}): Promise<any[]> {
  const { db, companyId, threadId, messageId, uploaderId, attachments } = params;
  if (!attachments || attachments.length === 0) return [];
  if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`You can attach at most ${MAX_MESSAGE_ATTACHMENTS} files per message`);
  }
  const totalSizeValidation = validateMessageAttachmentTotalSize(attachments);
  if (!totalSizeValidation.ok) throw new Error(totalSizeValidation.error);

  const paths = attachments
    .filter((attachment) => isCompanyScopedMessagePath(companyId, attachment.path))
    .map((attachment) => attachment.path);
  try {
    const rows: any[] = [];
    for (const attachment of attachments) {
      // Ownership: never allow linking an object outside this company's namespace.
      if (!isCompanyScopedMessagePath(companyId, attachment.path)) {
        throw new Error("Invalid attachment path");
      }
      const validation = validateMessageFileMeta(attachment);
      if (!validation.ok) throw new Error(validation.error);

      const bucket = db.storage.from(MESSAGE_ATTACHMENTS_BUCKET);
      // A signed URL proves the object exists. Storage info additionally proves
      // the completed object has the exact byte count and MIME type the client
      // declared, so a partial or substituted upload can never be linked.
      const check = await bucket.createSignedUrl(attachment.path, 60);
      if (check.error || !check.data?.signedUrl) {
        throw new Error("Uploaded file not found");
      }
      if (typeof bucket.info === "function") {
        const info = await bucket.info(attachment.path);
        if (info.error || !info.data) throw new Error("Uploaded file not found");
        const actualSize = Number(info.data.size);
        if (!Number.isFinite(actualSize) || actualSize !== Number(attachment.file_size)) {
          throw new Error("Uploaded file is incomplete or has an unexpected size");
        }
        const actualContentType = String(info.data.contentType ?? "").toLowerCase().split(";")[0].trim();
        if (actualContentType && actualContentType !== validation.contentType) {
          throw new Error("Uploaded file content type does not match");
        }
      }

      rows.push({
        company_id: companyId,
        message_id: messageId,
        thread_id: threadId,
        uploader_id: uploaderId,
        file_name: validation.safeFileName,
        content_type: validation.contentType,
        file_size: Number(attachment.file_size),
        storage_bucket: MESSAGE_ATTACHMENTS_BUCKET,
        storage_path: attachment.path,
      });
    }

    const insertResult = await db.from("message_attachments").insert(rows).select("*");
    if (insertResult.error) throw new Error(insertResult.error.message || "Failed to save attachments");
    return signAttachments(db, insertResult.data ?? []);
  } catch (error) {
    await db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).remove(paths).catch(() => null);
    throw error;
  }
}

async function signAttachments(db: any, rows: any[]): Promise<any[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await db.storage
        .from(row.storage_bucket ?? MESSAGE_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
      return mapMessageAttachment(row, signed?.signedUrl ?? null);
    })
  );
}

// Fetch attachments for a set of messages and attach signed download URLs,
// returning a map of message_id -> attachment[]. Tenant-scoped by company_id.
export async function attachmentsForMessages(
  db: any,
  companyId: string,
  messageIds: string[]
): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  if (messageIds.length === 0) return map;

  const result = await db
    .from("message_attachments")
    .select("*")
    .eq("company_id", companyId)
    .in("message_id", messageIds);

  // Tolerate environments where the migration hasn't run yet.
  if (result.error) {
    if (/message_attachments/i.test(result.error.message || "")) return map;
    throw new Error(result.error.message);
  }

  const signed = await signAttachments(db, result.data ?? []);
  for (const attachment of signed) {
    const key = String(attachment.message_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(attachment);
  }
  return map;
}
