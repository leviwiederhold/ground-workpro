import { Upload } from "tus-js-client";
import { MAX_VIDEO_DURATION_SECONDS } from "./attachmentPolicy.ts";

export const SUPABASE_TUS_CHUNK_BYTES = 6 * 1024 * 1024;
export const MESSAGE_UPLOAD_RETRY_DELAYS_MS = [0, 3_000, 5_000, 10_000, 20_000];

type TusUploadOptions = ConstructorParameters<typeof Upload>[1];
type TusUploadLike = Pick<
  Upload,
  "abort" | "findPreviousUploads" | "resumeFromPreviousUpload" | "start"
>;

export async function readVideoDurationSeconds(file: File): Promise<number> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Video inspection is unavailable on this device");
  }

  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(file);

  return new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const timeoutId = window.setTimeout(
      () => fail("Could not read the video. Try MP4, MOV, M4V, or WebM"),
      10_000
    );

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        fail("Could not read the video duration");
        return;
      }
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        fail(`Video is longer than ${MAX_VIDEO_DURATION_SECONDS / 60} minutes`);
        return;
      }
      cleanup();
      resolve(duration);
    };
    video.onerror = () => fail("This video cannot be previewed. Try MP4, MOV, M4V, or WebM");
    video.src = objectUrl;
  });
}

export function buildSupabaseResumableEndpoint(supabaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("Storage service URL is invalid");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Storage service URL must use HTTPS");
  }

  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  // Signed upload tokens are only verified on Supabase Storage's dedicated
  // TUS signed route. Sending x-signature to the authenticated route makes
  // Storage parse the token as an Auth JWT and reject it as an invalid JWS.
  url.pathname = "/storage/v1/upload/resumable/sign";
  url.search = "";
  url.hash = "";
  return url.toString();
}

// Supabase recommends TUS for every upload above 6 MB. We use it for every
// message attachment so small and large files share one progress/retry path,
// while the fixed 6 MB chunk size keeps mobile retries bandwidth-efficient.
export function uploadAttachmentWithProgress(input: {
  supabaseUrl: string;
  bucket: string;
  path: string;
  token: string;
  file: File;
  contentType: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  createUpload?: (file: File, options: TusUploadOptions) => TusUploadLike;
}): Promise<void> {
  const endpoint = buildSupabaseResumableEndpoint(input.supabaseUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    const uploadRef: { current: TusUploadLike | null } = { current: null };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abortUpload);
      callback();
    };
    const options: TusUploadOptions = {
      endpoint,
      retryDelays: MESSAGE_UPLOAD_RETRY_DELAYS_MS,
      chunkSize: SUPABASE_TUS_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      headers: {
        ...(input.headers ?? {}),
        "x-signature": input.token,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: input.bucket,
        objectName: input.path,
        contentType: input.contentType,
        cacheControl: "3600",
      },
      fingerprint: async (file) =>
        [
          "groundwork-message-attachment",
          input.bucket,
          input.path,
          file.name,
          file.size,
          file.lastModified,
        ].join(":"),
      onProgress: (bytesUploaded, bytesTotal) => {
        if (bytesTotal <= 0) return;
        input.onProgress?.(Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100)));
      },
      onError: (error) => {
        // TUS retries transient failures first. If all retries are exhausted,
        // terminate the provider-side partial upload before exposing Retry.
        const currentUpload = uploadRef.current;
        if (!currentUpload) {
          finish(() => reject(new Error(error.message || "Upload failed. Check your connection and try again")));
          return;
        }
        void currentUpload.abort(true).catch(() => undefined).finally(() => {
          finish(() => reject(new Error(error.message || "Upload failed. Check your connection and try again")));
        });
      },
      onSuccess: () => {
        input.onProgress?.(100);
        finish(resolve);
      },
    };

    const upload = input.createUpload?.(input.file, options) ?? new Upload(input.file, options);
    uploadRef.current = upload;
    const abortUpload = () => {
      void upload.abort(true).catch(() => undefined).finally(() => (
        finish(() => reject(new Error("Upload was canceled")))
      ));
    };
    if (input.signal?.aborted) {
      abortUpload();
      return;
    }
    input.signal?.addEventListener("abort", abortUpload, { once: true });

    void upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (input.signal?.aborted) return;
        if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch((error) => finish(() => reject(error instanceof Error ? error : new Error("Upload failed"))));
  });
}
