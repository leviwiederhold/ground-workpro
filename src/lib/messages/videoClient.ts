import { MAX_VIDEO_DURATION_SECONDS } from "./attachmentPolicy.ts";

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
        fail(`Video is longer than ${MAX_VIDEO_DURATION_SECONDS} seconds`);
        return;
      }
      cleanup();
      resolve(duration);
    };
    video.onerror = () => fail("This video cannot be previewed. Try MP4, MOV, M4V, or WebM");
    video.src = objectUrl;
  });
}

export function uploadAttachmentWithProgress(input: {
  signedUrl: string;
  file: File;
  contentType: string;
  headers?: Record<string, string>;
  allowedOrigin?: string;
  onProgress?: (percent: number) => void;
  createRequest?: () => XMLHttpRequest;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    let targetUrl: URL;
    try {
      targetUrl = new URL(input.signedUrl);
    } catch {
      reject(new Error("Upload URL is invalid"));
      return;
    }
    if (input.allowedOrigin && targetUrl.origin !== new URL(input.allowedOrigin).origin) {
      reject(new Error("Upload URL does not match the configured storage service"));
      return;
    }
    const request = input.createRequest?.() ?? new XMLHttpRequest();
    request.open("PUT", targetUrl.toString(), true);
    request.setRequestHeader("cache-control", "max-age=3600");
    request.setRequestHeader("content-type", input.contentType);
    request.setRequestHeader("x-upsert", "false");
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      if (value) request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      input.onProgress?.(percent);
    };
    request.onerror = () => reject(new Error("Upload failed. Check your connection and try again"));
    request.onabort = () => reject(new Error("Upload was canceled"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed (${request.status || "network error"})`));
    };
    request.send(input.file);
  });
}
