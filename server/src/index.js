import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";

import { mintClientToken, isDecartConfigured } from "./decart.js";
import { setCurrentSession, clearCurrentSession, getCurrentSession } from "./streamSession.js";

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, decartConfigured: isDecartConfigured() });
});

// Mints a short-lived Decart client token for the browser. The permanent
// DECART_API_KEY never leaves this server. Used by both the Studio page
// (producer) and the OBS output page (viewer).
app.post("/api/decart-token", async (req, res) => {
  try {
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
});
