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

const nextConfig: NextConfig = {};

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
