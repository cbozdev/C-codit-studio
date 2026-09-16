import { createClient } from "@supabase/supabase-js";

let client = null;

/**
 * Admin client using the service_role key — bypasses Row Level Security.
 * Only ever used server-side. All money-affecting writes (wallet balances,
 * transactions, pricing) go through this, never through a client-supplied
 * value trusted at face value.
 */
export function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Verifies a user's access token (sent by the browser after Supabase Auth
 * sign-in) and returns the authenticated user, or null if invalid/expired.
 * This is the only thing the server trusts to know who's making a request —
 * never a client-supplied user id.
 */
export async function getUserFromToken(accessToken) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}
