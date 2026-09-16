import { getSupabaseAdmin } from "./supabase.js";

export async function getWallet(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("wallets")
    .select("balance_credits")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error("Could not read wallet balance.");
  return data.balance_credits;
}

export async function getCreditsPerSecond() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pricing_config")
    .select("credits_per_second")
    .eq("id", 1)
    .single();
  if (error) throw new Error("Could not read pricing config.");
  return Number(data.credits_per_second);
}

/** Credits or debits a wallet atomically. Returns the new balance. */
export async function adjustBalance(userId, delta) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("adjust_wallet_balance", {
    p_user_id: userId,
    p_delta: delta,
  });
  if (error) throw new Error("Could not adjust wallet balance.");
  return data;
}

/**
 * Atomically deducts `amount` credits if (and only if) the balance can
 * cover it. Returns the new balance, or null if there wasn't enough.
 */
export async function reserveCredits(userId, amount) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("reserve_wallet_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw new Error("Could not reserve wallet credits.");
  return data === -1 ? null : data;
}

export async function recordTransaction({ userId, type, credits, amountNgn, korapayReference, status }) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    type,
    credits,
    amount_ngn: amountNgn ?? null,
    korapay_reference: korapayReference ?? null,
    status,
  });
  if (error) throw new Error("Could not record transaction.");
}
