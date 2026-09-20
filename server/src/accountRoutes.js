import express from "express";
import { requireAuth } from "./authMiddleware.js";
import { getSupabaseAdmin } from "./supabase.js";
import { getUserSession, clearUserSession } from "./streamSession.js";
import { accountDeleteLimiter } from "./rateLimit.js";

export const accountRouter = express.Router();

// Deletes the signed-in user's own account. profiles/wallets/transactions/
// stream_sessions all reference auth.users with "on delete cascade" (see
// schema.sql), so removing the auth user removes everything else in one
// step — nothing orphaned, no manual cleanup needed here.
accountRouter.delete("/", requireAuth, accountDeleteLimiter, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.auth.admin.deleteUser(req.user.id);
    if (error) throw error;

    // Clear this user's OBS-visible session, if any, so a deleted account's
    // stream doesn't keep dangling around as "live" for its own viewers.
    if (getUserSession(req.user.id).active) clearUserSession(req.user.id);

    res.json({ ok: true });
  } catch (err) {
    console.error("account delete error", err);
    res.status(500).json({ error: "Could not delete account." });
  }
});
