import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";

const shouldLogRequests = process.env.REQUEST_LOGGING_ENABLED !== "false";

export function middleware(request: NextRequest, event: NextFetchEvent) {
  if (shouldLogRequests) {
    const method = request.method;
    const path = request.nextUrl.pathname;
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    event.waitUntil(
      Promise.resolve().then(() => {
        console.info(`[api] ${method} ${path} ip=${ip}`);
      })
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
