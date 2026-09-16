// Tracks the one currently-live Decart producer session in memory, so the
// separate OBS output page can find and subscribe to it without any account
// system — this app is single-user. A multi-user deployment would key this
// by account/session id instead of holding a single global value.
let currentSession = null;

export function setCurrentSession({ subscribeToken, model }) {
  currentSession = { subscribeToken, model, startedAt: currentSession?.startedAt ?? Date.now() };
}

export function clearCurrentSession() {
  currentSession = null;
}

export function getCurrentSession() {
  if (!currentSession) return { active: false };
  return { active: true, ...currentSession };
}
