/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "crypto";
import { validateAttachmentMetadata } from "@/src/lib/attachments/security";

export const MESSAGE_ATTACHMENTS_BUCKET = "message-attachments";
export const MAX_MESSAGE_ATTACHMENTS = 10;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function isImageContentType(contentType: string | null | undefined): boolean {
  return String(contentType ?? "").toLowerCase().startsWith("image/");
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
    bucket: row.storage_bucket ?? MESSAGE_ATTACHMENTS_BUCKET,
    path: row.storage_path ?? "",
    created_at: row.created_at ?? "",
    download_url: signedUrl,
    signedDownloadUrl: signedUrl,
  };
}

type PreparedFile = {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  path: string;
};

// Validate + hash a single incoming file. Rejects disallowed/dangerous types
// and oversized files (server-side) via the shared attachment security allowlist.
async function toPrepared(companyId: string, file: File): Promise<PreparedFile | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateAttachmentMetadata({
    fileName: file.name || "upload.bin",
    contentType: file.type || "application/octet-stream",
    sizeBytes: bytes.byteLength,
  });
  if (!validation.ok) return { error: validation.error };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const extMatch = validation.safeFileName.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : "";
  // Content-hashed, company-scoped path → identical bytes are stored once.
  const path = `${companyId}/messages/${sha256}${ext}`;
  return {
    bytes,
    fileName: validation.safeFileName,
    contentType: validation.contentType,
    size: bytes.byteLength,
    sha256,
    path,
  };
}

// Upload + persist attachments for a just-created message. Uploads are
// deduplicated by content hash (a matching object is reused, not re-uploaded).
// On any failure, storage objects uploaded during THIS call are cleaned up and
// an error is thrown so the caller can roll back the message.
export async function persistMessageAttachments(params: {
  db: any;
  companyId: string;
  threadId: string;
  messageId: string;
  uploaderId: string;
  files: File[];
}): Promise<any[]> {
  const { db, companyId, threadId, messageId, uploaderId, files } = params;
  if (files.length === 0) return [];
  if (files.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`You can attach at most ${MAX_MESSAGE_ATTACHMENTS} files per message`);
  }

  const prepared: PreparedFile[] = [];
  for (const file of files) {
    const result = await toPrepared(companyId, file);
    if ("error" in result) throw new Error(result.error);
    prepared.push(result);
  }

  const newlyUploadedPaths: string[] = [];
  try {
    for (const p of prepared) {
      const { error: uploadError } = await db.storage
        .from(MESSAGE_ATTACHMENTS_BUCKET)
        .upload(p.path, p.bytes, { upsert: false, contentType: p.contentType });
      if (uploadError) {
        // Duplicate object == dedupe hit (same bytes already stored). Reuse it.
        const message = String(uploadError.message || "").toLowerCase();
        const isDuplicate =
          message.includes("already exists") ||
          message.includes("duplicate") ||
          (uploadError as any).statusCode === "409";
        if (!isDuplicate) throw new Error(uploadError.message || "Failed to upload attachment");
      } else {
        newlyUploadedPaths.push(p.path);
      }
    }

    const rows = prepared.map((p) => ({
      company_id: companyId,
      message_id: messageId,
      thread_id: threadId,
      uploader_id: uploaderId,
      file_name: p.fileName,
      content_type: p.contentType,
      file_size: p.size,
      storage_bucket: MESSAGE_ATTACHMENTS_BUCKET,
      storage_path: p.path,
      content_sha256: p.sha256,
    }));

    const insertResult = await db.from("message_attachments").insert(rows).select("*");
    if (insertResult.error) throw new Error(insertResult.error.message || "Failed to save attachments");

    return signAttachments(db, insertResult.data ?? []);
  } catch (error) {
    // Roll back ONLY the objects this request uploaded (never a deduped/shared one).
    if (newlyUploadedPaths.length > 0) {
      await db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).remove(newlyUploadedPaths).catch(() => null);
    }
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
