import express from "express";
import crypto from "node:crypto";
import { requireAuth } from "./authMiddleware.js";
import { getSupabaseAdmin } from "./supabase.js";
import { adjustBalance, recordTransaction } from "./wallet.js";
import { initializeCharge, verifyWebhookSignature } from "./korapay.js";

export const walletRouter = express.Router();

// Starts a top-up: looks up the pack SERVER-SIDE by id (never trusts a
// client-submitted price or credit amount) and asks Korapay for a hosted
// checkout link.
walletRouter.post("/topup", requireAuth, async (req, res) => {
  try {
    const { packId } = req.body || {};
    if (!packId) return res.status(400).json({ error: "packId is required." });

    const supabase = getSupabaseAdmin();
    const { data: pack, error: packErr } = await supabase
      .from("packs")
      .select("id, name, credits, price_ngn, active")
      .eq("id", packId)
      .single();
    if (packErr || !pack || !pack.active) {
      return res.status(404).json({ error: "That pack is not available." });
    }

    const reference = `cstudio_${req.user.id.slice(0, 8)}_${crypto.randomBytes(6).toString("hex")}`;
    const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;

    await recordTransaction({
      userId: req.user.id,
      type: "topup",
      credits: pack.credits,
      amountNgn: pack.price_ngn,
      korapayReference: reference,
      status: "pending",
    });

    const charge = await initializeCharge({
      amountNgn: pack.price_ngn,
      reference,
      email: req.user.email,
      redirectUrl: `${origin}/?topup=complete`,
      notificationUrl: `${req.protocol}://${req.get("host")}/api/webhooks/korapay`,
    });

    res.json({ checkoutUrl: charge.checkout_url, reference: charge.reference });
  } catch (err) {
    const status = err.code === "KORAPAY_NOT_CONFIGURED" ? 503 : 500;
    console.error("wallet/topup error", err);
    res.status(status).json({ error: err.message || "Could not start top-up." });
  }
});

walletRouter.get("/", requireAuth, async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wallets")
    .select("balance_credits")
    .eq("user_id", req.user.id)
    .single();
  if (error) return res.status(500).json({ error: "Could not read wallet." });
  res.json({ balanceCredits: data.balance_credits });
});

// Korapay calls this server-to-server when a payment completes. This is the
// ONLY place a wallet gets credited from a top-up — never from anything the
// browser itself reports, since that could be faked. The signature check
// below is what makes this endpoint trustworthy at all: without it, anyone
// could POST a fake "success" here and get free credits.
export const korapayWebhookRouter = express.Router();

korapayWebhookRouter.post("/", async (req, res) => {
  const signature = req.headers["x-korapay-signature"];
  const { event, data } = req.body || {};

  if (!verifyWebhookSignature(data, signature)) {
    console.warn("[korapay webhook] invalid signature, rejecting");
    return res.status(401).json({ error: "Invalid signature." });
  }

  if (event !== "charge.success" || data?.status !== "success") {
    return res.json({ ok: true, ignored: true });
  }

  const supabase = getSupabaseAdmin();
  const { data: txn, error } = await supabase
    .from("transactions")
    .select("id, user_id, credits, status")
    .eq("korapay_reference", data.reference)
    .single();

  if (error || !txn) {
    console.warn("[korapay webhook] unknown reference", data.reference);
    return res.status(404).json({ error: "Unknown transaction." });
  }
  if (txn.status === "completed") {
    return res.json({ ok: true, alreadyProcessed: true }); // idempotent
  }

  await adjustBalance(txn.user_id, txn.credits);
  await supabase.from("transactions").update({ status: "completed" }).eq("id", txn.id);

  res.json({ ok: true });
});
