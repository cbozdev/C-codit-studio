import express from "express";
import { requireAuth } from "./authMiddleware.js";
import { getSupabaseAdmin } from "./supabase.js";
import { getCreditsPerSecond, reserveCredits, adjustBalance, recordTransaction } from "./wallet.js";
import { mintClientToken } from "./decart.js";

const MAX_SESSION_SECONDS = 1800; // absolute cap regardless of balance, cost-safety net

export const streamRouter = express.Router();

// Starts a billed streaming session: figures out how many seconds the
// user's current balance can afford, reserves that many credits UP FRONT
// (atomically, so two rapid clicks can't both succeed), and caps the
// underlying Decart session to that exact duration so the client can never
// stream for longer than what was actually paid for — regardless of what
// the browser does or doesn't report back to us.
streamRouter.post("/start", requireAuth, async (req, res) => {
  try {
    const creditsPerSecond = await getCreditsPerSecond();
    const supabase = getSupabaseAdmin();

    // A session can be left "active" forever if the browser crashes or the
    // tab is closed without hitting Stop. Before deciding whether this user
    // may start a new one, resolve any stale session of theirs: if it's past
    // its own paid-for duration it's definitely over, so close it out (no
    // refund — the full reservation covers exactly maxSessionDuration, which
    // Decart itself enforces server-side, so nothing is left unused). If it's
    // still within its window, it might genuinely be live — block a second
    // concurrent stream rather than silently double-billing the same account.
    const { data: openSessions, error: openErr } = await supabase
      .from("stream_sessions")
      .select("id, started_at, max_seconds")
      .eq("user_id", req.user.id)
      .eq("status", "active");
    if (openErr) throw openErr;

    const GRACE_SECONDS = 30;
    for (const s of openSessions || []) {
      const ageSeconds = (Date.now() - new Date(s.started_at).getTime()) / 1000;
      if (ageSeconds > s.max_seconds + GRACE_SECONDS) {
        await supabase
          .from("stream_sessions")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", s.id);
      } else {
        return res.status(409).json({ error: "You already have an active stream. Stop it before starting a new one." });
      }
    }

    const { data: wallet, error: walletErr } = await supabase
      .from("wallets")
      .select("balance_credits")
      .eq("user_id", req.user.id)
      .single();
    if (walletErr) throw walletErr;

    const affordableSeconds = Math.floor(wallet.balance_credits / creditsPerSecond);
    const maxSeconds = Math.min(affordableSeconds, MAX_SESSION_SECONDS);
    if (maxSeconds <= 0) {
      return res.status(402).json({ error: "Insufficient credits. Top up your wallet to start streaming." });
    }

    const reserveAmount = maxSeconds * creditsPerSecond;
    const newBalance = await reserveCredits(req.user.id, reserveAmount);
    if (newBalance === null) {
      // Balance changed between the read above and the reservation (e.g. a
      // concurrent request) — fail safe rather than let it through.
      return res.status(402).json({ error: "Insufficient credits. Top up your wallet to start streaming." });
    }

    const { data: session, error: sessionErr } = await supabase
      .from("stream_sessions")
      .insert({
        user_id: req.user.id,
        max_seconds: maxSeconds,
        credits_charged: reserveAmount,
        status: "active",
      })
      .select("id, started_at")
      .single();
    if (sessionErr) {
      await adjustBalance(req.user.id, reserveAmount); // roll back the reservation
      throw sessionErr;
    }

    const token = await mintClientToken(req.headers.origin, { maxSessionDuration: maxSeconds });

    res.json({
      ...token,
      sessionId: session.id,
      maxSeconds,
      balance: newBalance,
    });
  } catch (err) {
    console.error("stream/start error", err);
    res.status(500).json({ error: "Could not start stream." });
  }
});

// Ends a billed session: refunds whatever portion of the up-front reservation
// wasn't actually used, based on the server's own clock (started_at, stored
// at session-creation time) — never on a duration the client claims.
streamRouter.post("/stop", requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

    const supabase = getSupabaseAdmin();
    const { data: session, error: sessionErr } = await supabase
      .from("stream_sessions")
      .select("id, user_id, started_at, max_seconds, credits_charged, status")
      .eq("id", sessionId)
      .single();
    if (sessionErr || !session || session.user_id !== req.user.id) {
      return res.status(404).json({ error: "Session not found." });
    }
    if (session.status === "ended") {
      return res.json({ ok: true, alreadyEnded: true });
    }

    const creditsPerSecond = await getCreditsPerSecond();
    const elapsedSeconds = Math.min(
      Math.ceil((Date.now() - new Date(session.started_at).getTime()) / 1000),
      session.max_seconds
    );
    const actualCost = Math.ceil(elapsedSeconds * creditsPerSecond);
    const refund = Math.max(0, session.credits_charged - actualCost);

    if (refund > 0) {
      await adjustBalance(req.user.id, refund);
    }
    await recordTransaction({
      userId: req.user.id,
      type: "stream_usage",
      credits: -actualCost,
      status: "completed",
    });
    await supabase
      .from("stream_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), credits_charged: actualCost })
      .eq("id", sessionId);

    res.json({ ok: true, secondsUsed: elapsedSeconds, creditsCharged: actualCost, refunded: refund });
  } catch (err) {
    console.error("stream/stop error", err);
    res.status(500).json({ error: "Could not stop stream cleanly." });
  }
});
