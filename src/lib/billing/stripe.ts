const REQUIRED_STRIPE_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID"] as const;

export function isStripeConfigured() {
  return REQUIRED_STRIPE_ENV_KEYS.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}
