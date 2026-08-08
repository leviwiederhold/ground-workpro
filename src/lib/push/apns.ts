import "server-only";

import { connect, type ClientHttp2Session } from "node:http2";
import { randomUUID, sign } from "node:crypto";
import { classifyApnsResponse, type PushEnvironment } from "@/lib/push/domain";

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
};

export type ApnsSendResult = {
  ok: boolean;
  status: number;
  providerId: string | null;
  reason: string | null;
  invalidToken: boolean;
  retryable: boolean;
};

let cachedProviderToken: { value: string; issuedAt: number; cacheKey: string } | null = null;
const sessions = new Map<PushEnvironment, ClientHttp2Session>();

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function readConfig(): ApnsConfig {
  const teamId = String(process.env.APNS_TEAM_ID ?? "").trim();
  const keyId = String(process.env.APNS_KEY_ID ?? "").trim();
  const privateKey = String(process.env.APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const bundleId = String(process.env.APNS_BUNDLE_ID ?? "com.leviwiederhold.groundworkpro").trim();

  if (!teamId || !keyId || !privateKey || !bundleId) {
    throw new Error("APNs provider is not configured");
  }
  return { teamId, keyId, privateKey, bundleId };
}

function providerToken(config: ApnsConfig): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cacheKey = `${config.teamId}:${config.keyId}`;
  // Apple accepts tokens for one hour and asks providers not to rotate them
  // more frequently than every 20 minutes. Reuse for 50 minutes.
  if (
    cachedProviderToken &&
    cachedProviderToken.cacheKey === cacheKey &&
    nowSeconds - cachedProviderToken.issuedAt < 50 * 60
  ) {
    return cachedProviderToken.value;
  }

  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const value = `${signingInput}.${base64Url(signature)}`;
  cachedProviderToken = { value, issuedAt: nowSeconds, cacheKey };
  return value;
}

function apnsOrigin(environment: PushEnvironment): string {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function getSession(environment: PushEnvironment): ClientHttp2Session {
  const current = sessions.get(environment);
  if (current && !current.closed && !current.destroyed) return current;

  const session = connect(apnsOrigin(environment));
  session.setTimeout(55_000, () => session.close());
  session.on("close", () => {
    if (sessions.get(environment) === session) sessions.delete(environment);
  });
  session.on("error", () => {
    if (sessions.get(environment) === session) sessions.delete(environment);
  });
  sessions.set(environment, session);
  return session;
}

export async function sendApnsNotification(input: {
  token: string;
  environment: PushEnvironment;
  title: string;
  body: string;
  threadId: string;
  messageId: string;
}): Promise<ApnsSendResult> {
  const config = readConfig();
  const token = String(input.token).trim();
  if (!/^[a-fA-F0-9]+$/.test(token)) {
    return {
      ok: false,
      status: 400,
      providerId: null,
      reason: "BadDeviceToken",
      invalidToken: true,
      retryable: false,
    };
  }

  const requestId = randomUUID();
  const payload = JSON.stringify({
    aps: {
      alert: { title: input.title, body: input.body },
      sound: "default",
      "thread-id": input.threadId,
    },
    type: "new_message",
    threadId: input.threadId,
    messageId: input.messageId,
  });

  return new Promise<ApnsSendResult>((resolve, reject) => {
    const session = getSession(input.environment);
    let responseStatus = 0;
    let providerId: string | null = requestId;
    let responseBody = "";
    let settled = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
      "apns-id": requestId,
      "content-type": "application/json",
    });

    request.setEncoding("utf8");
    request.setTimeout(12_000, () => request.close());
    request.on("response", (headers) => {
      responseStatus = Number(headers[":status"] ?? 0);
      providerId = String(headers["apns-id"] ?? requestId);
    });
    request.on("data", (chunk: string) => {
      responseBody += chunk;
    });
    request.on("error", finishError);
    request.on("timeout", () => finishError(new Error("APNs request timed out")));
    request.on("end", () => {
      if (settled) return;
      settled = true;
      let reason: string | null = null;
      if (responseBody) {
        try {
          const parsed = JSON.parse(responseBody) as { reason?: unknown };
          reason = parsed.reason ? String(parsed.reason) : null;
        } catch {
          reason = "InvalidProviderResponse";
        }
      }
      const classification = classifyApnsResponse(responseStatus, reason);
      resolve({
        ok: responseStatus === 200,
        status: responseStatus,
        providerId,
        reason,
        ...classification,
      });
    });
    request.end(payload);
  });
}
