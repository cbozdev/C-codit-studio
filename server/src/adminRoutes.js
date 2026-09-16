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
  const { creditsPerSecond } = req.body || {};
  const value = Number(creditsPerSecond);
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: "creditsPerSecond must be a positive number." });
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("pricing_config")
    .update({ credits_per_second: value, updated_at: new Date().toISOString() })
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
      .select("id, user_id, type, credits, amount_ngn, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (usersErr || txErr) return res.status(500).json({ error: "Could not load overview." });
  res.json({ users, transactions });
});
