import Stripe from "stripe";

const REQUIRED_STRIPE_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID"] as const;

export function isStripeConfigured() {
  return REQUIRED_STRIPE_ENV_KEYS.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  return new Stripe(secretKey);
}

export function getStripePriceId() {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID is not configured");
  }

  return priceId;
}
