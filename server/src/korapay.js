import crypto from "node:crypto";

const API_BASE = "https://api.korapay.com/merchant/api/v1";

export function isKorapayConfigured() {
  return Boolean(process.env.KORAPAY_SECRET_KEY);
}

/**
 * Initializes a hosted checkout charge. `amountNgn` and `reference` must
 * come from server-side data (a pack looked up by id), never from a
 * client-submitted price — that's the whole point of not trusting the
 * browser with money.
 */
export async function initializeCharge({ amountNgn, reference, email, redirectUrl, notificationUrl }) {
  if (!isKorapayConfigured()) {
    const err = new Error("Korapay is not configured on the server yet (KORAPAY_SECRET_KEY missing).");
    err.code = "KORAPAY_NOT_CONFIGURED";
    throw err;
  }

  const res = await fetch(`${API_BASE}/charges/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KORAPAY_SECRET_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: amountNgn,
      currency: "NGN",
      reference,
      customer: { email },
      redirect_url: redirectUrl,
      notification_url: notificationUrl,
    }),
  });

  const body = await res.json();
  if (!res.ok || !body.status) {
    throw new Error(body.message || "Could not initialize payment.");
  }
  return body.data; // { reference, checkout_url }
}

/**
 * Verifies a webhook actually came from Korapay: an HMAC-SHA256 of the
 * `data` object (only), signed with the account's secret key (Korapay
 * doesn't use a separate webhook-signing secret — per their docs, it's the
 * same sk_... key used for API auth), must match the `x-korapay-signature`
 * header. Without this check, anyone could POST a fake "payment succeeded"
 * request straight at our webhook endpoint and credit themselves free
 * credits.
 */
export function verifyWebhookSignature(dataObject, signatureHeader) {
  if (!process.env.KORAPAY_SECRET_KEY || !signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", process.env.KORAPAY_SECRET_KEY)
    .update(JSON.stringify(dataObject))
    .digest("hex");
  // Constant-time comparison to avoid leaking the expected value via timing.
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
