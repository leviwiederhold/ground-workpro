import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.warn(
    `Warning: Missing Supabase environment variables at build time: ${missingEnv.join(", ")}`
  );
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "media-src 'self' data: blob: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()",
  },
];

// Client-side "pretty" paths for in-app views (history.pushState targets in
// app/page.tsx -> APP_VIEW_PATHS). These have no server route, so a direct load
// or reload of e.g. /documents or /jobs would 404. Rewrite them to "/" so the
// single-page app boots and reads the view from the pathname. "/settings" is
// intentionally excluded — it has real route files (app/settings/**).
const SPA_VIEW_PATHS = [
  "messages",
  "schedule",
  "jobs",
  "fleet",
  "team",
  "inventory",
  "maintenance",
  "training",
  "safety",
  "bids",
  "vendors",
  "reports",
  "costing",
  "finance",
  "documents",
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    // afterFiles: real route files win; only unmatched SPA paths are rewritten.
    return {
      afterFiles: SPA_VIEW_PATHS.map((path) => ({
        source: `/${path}`,
        destination: "/",
      })),
    };
  },
};

const sentryEnabled =
  process.env.SENTRY_ENABLED === "true" &&
  Boolean(process.env.SENTRY_DSN) &&
  Boolean(process.env.SENTRY_ORG) &&
  Boolean(process.env.SENTRY_PROJECT);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      disableLogger: true,
    })
  : nextConfig;
