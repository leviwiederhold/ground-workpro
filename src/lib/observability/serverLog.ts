type LogLevel = "info" | "warn" | "error";

const REDACT_KEYS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "set-cookie",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (!isObject(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, inner]) => {
    const normalized = key.toLowerCase();
    if (REDACT_KEYS.some((candidate) => normalized.includes(candidate))) {
      out[key] = "[REDACTED]";
      return;
    }
    out[key] = redact(inner);
  });

  return out;
}

export function logServer(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? { context: redact(context) } : {}),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}
