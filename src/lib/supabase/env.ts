const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

function normalizeEnvValue(value: string | undefined) {
  if (!value) return value;
  const trimmed = value.trim();
  return trimmed.replace(/^["']|["']$/g, "");
}

export function getSupabaseEnv() {
  const rawUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const rawAnonKey = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const missing = ENV_KEYS.filter((key) => {
    if (key === "NEXT_PUBLIC_SUPABASE_URL") return !rawUrl;
    return !rawAnonKey;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase environment variables: ${missing.join(", ")}`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl!);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL: must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "Invalid NEXT_PUBLIC_SUPABASE_URL: must use http or https protocol"
    );
  }

  return {
    url: parsed.toString().replace(/\/$/, ""),
    anonKey: rawAnonKey!,
  };
}
