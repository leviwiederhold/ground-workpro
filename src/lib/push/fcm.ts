import "server-only";

import { sign } from "node:crypto";
import { classifyFcmResponse } from "@/lib/push/domain";
import type { ApnsSendResult } from "@/lib/push/apns";

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type FcmErrorResponse = {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{ "@type"?: string; errorCode?: string }>;
  };
};

let cachedAccessToken: {
  value: string;
  expiresAt: number;
  cacheKey: string;
} | null = null;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function readConfig(): FcmConfig {
  const projectId = String(process.env.FCM_PROJECT_ID ?? "").trim();
  const clientEmail = String(process.env.FCM_CLIENT_EMAIL ?? "").trim();
  const privateKey = String(process.env.FCM_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FCM provider is not configured");
  }
  return { projectId, clientEmail, privateKey };
}

function serviceAccountAssertion(config: FcmConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      sub: config.clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      iat: now,
      exp: now + 60 * 60,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), config.privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

async function accessToken(config: FcmConfig): Promise<string> {
  const now = Date.now();
  const cacheKey = `${config.projectId}:${config.clientEmail}`;
  if (
    cachedAccessToken &&
    cachedAccessToken.cacheKey === cacheKey &&
    cachedAccessToken.expiresAt - now > 5 * 60 * 1000
  ) {
    return cachedAccessToken.value;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: serviceAccountAssertion(config),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(`FCM authentication failed (HTTP ${response.status})`);
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(300, Number(payload.expires_in ?? 3600)) * 1000,
    cacheKey,
  };
  return payload.access_token;
}

function fcmErrorCode(payload: FcmErrorResponse | null): string | null {
  const detail = payload?.error?.details?.find((item) =>
    String(item?.["@type"] ?? "").includes("google.firebase.fcm.v1.FcmError"),
  );
  return detail?.errorCode ? String(detail.errorCode) : null;
}

export async function sendFcmNotification(input: {
  token: string;
  title: string;
  body: string;
  threadId: string;
  messageId: string;
}): Promise<ApnsSendResult> {
  const config = readConfig();
  const token = String(input.token ?? "").trim();
  if (token.length < 16) {
    return {
      ok: false,
      status: 400,
      providerId: null,
      reason: "INVALID_ARGUMENT",
      invalidToken: true,
      retryable: false,
    };
  }

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(config)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: input.title, body: input.body },
          data: {
            type: "new_message",
            threadId: input.threadId,
            messageId: input.messageId,
          },
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "groundwork_messages",
              sound: "default",
              tag: `message-thread-${input.threadId}`,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | ({ name?: string } & FcmErrorResponse)
    | null;
  const providerId = payload?.name ? String(payload.name) : null;
  const errorCode = fcmErrorCode(payload);
  const reason = errorCode ?? payload?.error?.status ?? (response.ok ? null : `HTTP_${response.status}`);
  const classification = classifyFcmResponse(response.status, errorCode);

  return {
    ok: response.ok,
    status: response.status,
    providerId,
    reason,
    ...classification,
  };
}
