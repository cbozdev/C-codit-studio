import { createDecartClient } from "@decartai/sdk";

const MODEL_ID = "lucy-2.5";

let decartClient = null;

/**
 * Lazily creates the server-side Decart client. Returns null when
 * DECART_API_KEY isn't configured so the rest of the app can degrade
 * gracefully instead of crashing on boot.
 */
function getDecartClient() {
  if (!process.env.DECART_API_KEY) return null;
  if (!decartClient) {
    decartClient = createDecartClient({ apiKey: process.env.DECART_API_KEY });
  }
  return decartClient;
}

export function isDecartConfigured() {
  return Boolean(process.env.DECART_API_KEY);
}

/**
 * Mints a short-lived client token so the browser never sees the permanent
 * DECART_API_KEY. The token is scoped to the Lucy 2.5 realtime model and to
 * this deployment's origin.
 */
export async function mintClientToken(origin) {
  const client = getDecartClient();
  if (!client) {
    const err = new Error(
      "DECART_API_KEY is not configured on the server. Add it to server/.env to enable AI effects."
    );
    err.code = "DECART_NOT_CONFIGURED";
    throw err;
  }

  // No allowedOrigins here: Decart enforces that by matching the *browser's*
  // WebSocket Origin header during the realtime handshake, which happens
  // directly between the browser and Decart's servers — this backend never
  // sees it, so a wrong guess here silently breaks otherwise-valid requests
  // (e.g. from embedded/webview browsers whose Origin isn't a plain
  // http://host:port). Re-add it once deployed behind a single known origin.
  // expiresIn is the token credential's own lifetime — Decart's SDK does not
  // mint a fresh token on auto-reconnect, it just retries with the same one,
  // so a short expiresIn (e.g. 300s) makes any session that outlives it fail
  // permanently on its next ordinary reconnect with a confusing "Invalid API
  // key" error. 3600 is the max allowed. maxSessionDuration is a separate,
  // per-session cap enforced by Decart's servers regardless of token
  // lifetime — kept shorter than expiresIn as a cost-safety limit, since
  // Lucy 2.5 bills per second of active generation.
  const token = await client.tokens.create({
    expiresIn: 3600,
    allowedModels: [MODEL_ID],
    constraints: {
      realtime: { maxSessionDuration: 1800 },
    },
  });

  console.log(
    `[decart] minted client token for origin=${origin || "(none)"} apiKeyPrefix=${token.apiKey?.slice(0, 6)} expiresAt=${token.expiresAt}`
  );

  return { ...token, model: MODEL_ID };
}
