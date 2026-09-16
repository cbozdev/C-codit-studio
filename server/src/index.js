import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";

import { mintClientToken, isDecartConfigured } from "./decart.js";
import { setCurrentSession, clearCurrentSession, getCurrentSession } from "./streamSession.js";
import { isSupabaseConfigured } from "./supabase.js";
import { isKorapayConfigured } from "./korapay.js";
import { streamRouter } from "./streamRoutes.js";
import { walletRouter, korapayWebhookRouter } from "./walletRoutes.js";
import { adminRouter } from "./adminRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
// Comma-separated list, e.g. "https://c-coditstudio.com,https://www.c-coditstudio.com".
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (e.g. curl, server-to-server) — allow.
      if (!origin || CLIENT_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed`));
    },
  })
);

app.use(express.json());
app.use("/api/webhooks/korapay", korapayWebhookRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    decartConfigured: isDecartConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    korapayConfigured: isKorapayConfigured(),
  });
});

// Mints a short-lived Decart client token. Only used by the OBS output page
// now (a pure viewer, subscribing to an already-running producer session) —
// the Studio page gets its token from POST /api/stream/start instead, which
// ties minting to an authenticated, billed session. Gating this on "a
// session is currently live" closes off the endpoint as a free way to mint
// Decart credentials against our account with no session backing them.
app.post("/api/decart-token", async (req, res) => {
  try {
    if (!getCurrentSession().active) {
      return res.status(403).json({ error: "No stream is currently live." });
    }
    const token = await mintClientToken(req.headers.origin);
    res.json(token);
  } catch (err) {
    const status = err.code === "DECART_NOT_CONFIGURED" ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

// The Studio page (producer) registers its live session's subscribeToken
// here right after connecting; the OBS output page (viewer, a separate
// browser process with no access to the Studio page's camera or JS state)
// polls this to find out what to subscribe to.
app.post("/api/stream-session", (req, res) => {
  const { subscribeToken, model } = req.body || {};
  if (!subscribeToken) {
    return res.status(400).json({ error: "subscribeToken is required" });
  }
  setCurrentSession({ subscribeToken, model });
  res.json({ ok: true });
});

app.delete("/api/stream-session", (_req, res) => {
  clearCurrentSession();
  res.json({ ok: true });
});

app.get("/api/stream-session", (_req, res) => {
  res.json(getCurrentSession());
});

app.use("/api/stream", streamRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/admin", adminRouter);

// In production the client is pre-built (npm run build) and served directly
// from this same process/origin — no separate frontend host needed. In
// local dev the Vite dev server handles this instead (and proxies /api/*
// here), so client/dist won't exist yet and this is skipped.
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
  if (!isDecartConfigured()) {
    console.warn(
      "DECART_API_KEY is not set — AI Effects (Lucy 2.5) will be disabled until you add it to server/.env"
    );
  }
  if (!isSupabaseConfigured()) {
    console.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — accounts and wallets will not work.");
  }
  if (!isKorapayConfigured()) {
    console.warn("KORAPAY_SECRET_KEY not set — top-ups will not work until you add sandbox keys.");
  }
});
