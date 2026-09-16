import express from "express";
import { requireAuth, requireAdmin } from "./authMiddleware.js";
import { getSupabaseAdmin } from "./supabase.js";

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/pricing", async (_req, res) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("pricing_config").select("*").eq("id", 1).single();
  if (error) return res.status(500).json({ error: "Could not read pricing." });
  res.json(data);
});

adminRouter.put("/pricing", async (req, res) => {
  const { creditsPerSecond, decartCostPerSecondUsd, usdToNgnRate } = req.body || {};
  const value = Number(creditsPerSecond);
  const costValue = Number(decartCostPerSecondUsd);
  const rateValue = Number(usdToNgnRate);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: "creditsPerSecond must be a positive number." });
  }
  if (!Number.isFinite(costValue) || costValue <= 0) {
    return res.status(400).json({ error: "decartCostPerSecondUsd must be a positive number." });
  }
  if (!Number.isFinite(rateValue) || rateValue <= 0) {
    return res.status(400).json({ error: "usdToNgnRate must be a positive number." });
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("pricing_config")
    .update({
      credits_per_second: value,
      decart_cost_per_second_usd: costValue,
      usd_to_ngn_rate: rateValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return res.status(500).json({ error: "Could not update pricing." });
  res.json({ ok: true });
});

adminRouter.get("/packs", async (_req, res) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("packs").select("*").order("sort_order");
  if (error) return res.status(500).json({ error: "Could not read packs." });
  res.json(data);
});

adminRouter.post("/packs", async (req, res) => {
  const { name, credits, priceNgn, sortOrder } = req.body || {};
  if (!name || !Number.isFinite(Number(credits)) || !Number.isFinite(Number(priceNgn))) {
    return res.status(400).json({ error: "name, credits, and priceNgn are required." });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("packs")
    .insert({ name, credits, price_ngn: priceNgn, sort_order: sortOrder ?? 0 })
    .select()
    .single();
  if (error) return res.status(500).json({ error: "Could not create pack." });
  res.json(data);
});

adminRouter.put("/packs/:id", async (req, res) => {
  const { name, credits, priceNgn, active, sortOrder } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (credits !== undefined) patch.credits = credits;
  if (priceNgn !== undefined) patch.price_ngn = priceNgn;
  if (active !== undefined) patch.active = active;
  if (sortOrder !== undefined) patch.sort_order = sortOrder;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("packs").update(patch).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "Could not update pack." });
  res.json({ ok: true });
});

adminRouter.delete("/packs/:id", async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("packs").update({ active: false }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "Could not deactivate pack." });
  res.json({ ok: true });
});

// Manually credits or debits a user's wallet (support refunds, goodwill
// credits, debiting abuse) — always atomic (same RPC billing uses) and
// always logged as a transaction, tagged with which admin made the change.
adminRouter.post("/users/:id/adjust-balance", async (req, res) => {
  const { amount, note } = req.body || {};
  const value = Number(amount);
  if (!Number.isInteger(value) || value === 0) {
    return res.status(400).json({ error: "amount must be a non-zero whole number of credits." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: newBalance, error } = await supabase.rpc("admin_adjust_wallet", {
      p_user_id: req.params.id,
      p_delta: value,
      p_admin_email: req.user.email,
      p_note: note || null,
    });
    if (error) throw error;
    res.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error("admin adjust-balance error", err);
    res.status(500).json({ error: "Could not adjust balance." });
  }
});

adminRouter.get("/overview", async (_req, res) => {
  const supabase = getSupabaseAdmin();
  const [{ data: users, error: usersErr }, { data: transactions, error: txErr }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, role, created_at, wallets(balance_credits)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("transactions")
      .select("id, user_id, type, credits, amount_ngn, status, note, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (usersErr || txErr) return res.status(500).json({ error: "Could not load overview." });
  res.json({ users, transactions });
});
