// Tracks each user's currently-live Decart producer session in memory, so
// their own OBS output page can find and subscribe to it. Keyed by user id —
// a single global value here would mean two people streaming at the same
// time overwrite each other, and every OBS output on the platform would show
// whoever started (or re-published) most recently instead of its own owner.
const sessions = new Map();

export function setUserSession(userId, { subscribeToken, model }) {
  const existing = sessions.get(userId);
  sessions.set(userId, { subscribeToken, model, startedAt: existing?.startedAt ?? Date.now() });
}

export function clearUserSession(userId) {
  sessions.delete(userId);
}

export function getUserSession(userId) {
  const session = sessions.get(userId);
  if (!session) return { active: false };
  return { active: true, ...session };
}
