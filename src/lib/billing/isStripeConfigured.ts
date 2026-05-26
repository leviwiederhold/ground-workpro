export function isStripeConfigured(): boolean {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  return Boolean(secretKey && priceId && webhookSecret);
}
