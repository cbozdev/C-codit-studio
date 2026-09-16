import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// The anon key is safe to ship in the browser bundle — it's only ever as
// powerful as the database's Row Level Security policies allow (public
// pricing/packs, and a signed-in user's own rows). It is never used to
// write anything money-related; the server does that with its own
// service_role key instead.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;

export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
