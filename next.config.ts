import type { NextConfig } from "next";

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

export default nextConfig;
