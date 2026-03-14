const sentryEnabled =
  process.env.SENTRY_ENABLED === "true" &&
  Boolean(process.env.SENTRY_DSN);

const loadSentry = async () => {
  if (!sentryEnabled) return null;
  return Function('return import("@sentry/nextjs")')() as Promise<typeof import("@sentry/nextjs")>;
};

export async function register() {
  if (!sentryEnabled) return;

  const Sentry = await loadSentry();
  if (!Sentry) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
      sendDefaultPii: false,
    });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
      sendDefaultPii: false,
    });
  }
}

export async function onRequestError(...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) {
  const Sentry = await loadSentry();
  if (!Sentry) return;
  return Sentry.captureRequestError(...args);
}
