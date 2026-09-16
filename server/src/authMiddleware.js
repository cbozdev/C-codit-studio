import { getUserFromToken, getSupabaseAdmin } from "./supabase.js";

function extractToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" ? token : null;
}

/** Requires a valid Supabase session. Sets req.user on success. */
export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: "Sign in required." });
  }
  req.user = user;
  next();
}

/** Requires requireAuth to have already run. Sets req.profile on success. */
export async function requireAdmin(req, res, next) {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .single();

  if (error || profile?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  req.profile = profile;
  next();
}
