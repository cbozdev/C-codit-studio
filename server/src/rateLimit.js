import rateLimit from "express-rate-limit";

// Applied per-IP, on top of the requireAuth checks these routes already
// have — auth alone doesn't stop a single account (or script) from hammering
// a billing-adjacent endpoint. Limits are generous enough not to bother a
// real user clicking around, but cap scripted abuse.

export const topupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many top-up attempts. Please wait a few minutes and try again." },
});

export const streamStartLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many stream start attempts. Please wait a few minutes and try again." },
});

export const accountDeleteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a while and try again." },
});
