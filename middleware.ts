import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";

const shouldLogRequests = process.env.REQUEST_LOGGING_ENABLED !== "false";
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_START_HEADER = "x-request-start";

function buildRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER);
  if (existing && existing.trim().length > 0) return existing.trim();
  return crypto.randomUUID();
}

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const requestId = buildRequestId(request);
  const requestStart = Date.now().toString();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(REQUEST_START_HEADER, requestStart);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  if (shouldLogRequests) {
    const method = request.method;
    const path = request.nextUrl.pathname;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    event.waitUntil(
      Promise.resolve().then(() => {
        console.info(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            event: "api_request",
            request_id: requestId,
            method,
            path,
            ip,
          })
        );
      })
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
