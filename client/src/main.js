import "./style.css";
import { isWebRTCSupported, listDevices, getLocalStream, stopStream } from "./media.js";
import { DecartEffects, getRealtimeModel, checkConnection } from "./decart.js";
import { apiUrl } from "./api.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

// ---------- DOM ----------

const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const authHeading = document.getElementById("auth-heading");
const authSubheading = document.getElementById("auth-subheading");
const authEmailField = document.getElementById("auth-email-field");
const authEmailInput = document.getElementById("auth-email");
const authPasswordField = document.getElementById("auth-password-field");
const authPasswordInput = document.getElementById("auth-password");
const authForgotBtn = document.getElementById("auth-forgot-btn");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authError = document.getElementById("auth-error");
const authToggleModeBtn = document.getElementById("auth-toggle-mode");
const authTermsRow = document.getElementById("auth-terms-row");
const authTermsCheckbox = document.getElementById("auth-terms-checkbox");

const appShell = document.getElementById("app-shell");
const walletBalanceEl = document.getElementById("wallet-balance");
const walletBalanceTimeEl = document.getElementById("wallet-balance-time");
const sidebarTopupBtn = document.getElementById("sidebar-topup-btn");
const adminLink = document.getElementById("admin-link");
const signOutBtn = document.getElementById("sign-out-btn");

const appNav = document.getElementById("app-nav");
const panelTitle = document.getElementById("panel-title");
const panelLabels = {
  dashboard: "Dashboard",
  stream: "Start Stream",
  wallet: "Wallet",
  billing: "Billing",
  settings: "Settings",
};

const packListEl = document.getElementById("pack-list");
const topupStatus = document.getElementById("topup-status");

const headerStatusText = document.getElementById("header-status-text");
const headerStatus = document.getElementById("header-status");

const cameraSelect = document.getElementById("camera-select");
const cameraPreview = document.getElementById("camera-preview");
const cameraPlaceholder = document.getElementById("camera-placeholder");
const enableCameraBtn = document.getElementById("enable-camera-btn");

const outputPreview = document.getElementById("output-preview");
const outputPlaceholder = document.getElementById("output-placeholder");

const modeToggle = document.getElementById("mode-toggle");
const realisticControls = document.getElementById("realistic-controls");
const stylizedControls = document.getElementById("stylized-controls");
const realismSlider = document.getElementById("realism-slider");
const realismValue = document.getElementById("realism-value");

const presetGrid = document.getElementById("preset-grid");
const aiPromptInput = document.getElementById("ai-prompt");
const aiEnhanceInput = document.getElementById("ai-enhance");

const dropzone = document.getElementById("dropzone");
const dropzoneEmpty = document.getElementById("dropzone-empty");
const browseImageBtn = document.getElementById("browse-image-btn");
const aiImageInput = document.getElementById("ai-image-input");
const aiImagePreviewWrap = document.getElementById("ai-image-preview-wrap");
const aiImagePreview = document.getElementById("ai-image-preview");
const aiImageRemoveBtn = document.getElementById("ai-image-remove");

const streamToggleBtn = document.getElementById("stream-toggle-btn");
const streamStatus = document.getElementById("stream-status");

const testConnectionBtn = document.getElementById("test-connection-btn");
const connectionStatusEl = document.getElementById("connection-status");
const lowBalanceWarningEl = document.getElementById("low-balance-warning");

const LOW_BALANCE_SECONDS = 30;

function updateLowBalanceWarning(balance, creditsPerSecond) {
  const secondsLeft = Number(balance || 0) / creditsPerSecond;
  if (secondsLeft < LOW_BALANCE_SECONDS) {
    lowBalanceWarningEl.textContent = `Low balance — only ${Math.floor(secondsLeft)}s of streaming left. Top up to avoid an interrupted session.`;
    lowBalanceWarningEl.hidden = false;
  } else {
    lowBalanceWarningEl.hidden = true;
  }
}

const QUALITY_LABELS = { good: "Good", fair: "Fair", poor: "Poor", critical: "No connectivity" };
const TRANSPORT_LABELS = { udp: "direct connection", relay: "relayed — adds latency", failed: "no path found" };

testConnectionBtn?.addEventListener("click", async () => {
  testConnectionBtn.disabled = true;
  connectionStatusEl.className = "hint-inline";
  connectionStatusEl.textContent = "Testing…";
  try {
    const report = await checkConnection();
    const { quality, metrics, reasons } = report;
    const parts = [QUALITY_LABELS[quality] || quality, TRANSPORT_LABELS[metrics.transport] || metrics.transport];
    if (metrics.rttMs != null) parts.push(`~${metrics.rttMs}ms RTT`);
    connectionStatusEl.textContent = parts.join(" · ");
    connectionStatusEl.className = `hint-inline quality-${quality}`;
    connectionStatusEl.title = reasons.join(" ");
  } catch (err) {
    connectionStatusEl.textContent = "Could not run the test: " + err.message;
    connectionStatusEl.className = "hint-inline quality-poor";
  } finally {
    testConnectionBtn.disabled = false;
  }
});

const sessionStatusEl = document.getElementById("session-status");
const sessionDurationEl = document.getElementById("session-duration");
const sessionUsageEl = document.getElementById("session-usage");

const obsUrlInput = document.getElementById("obs-url");
const copyObsUrlBtn = document.getElementById("copy-obs-url");
const obsLiveBadge = document.getElementById("obs-live-badge");

const dashBalance = document.getElementById("dash-balance");
const dashBalanceTimeEl = document.getElementById("dash-balance-time");
const dashStreamedWeek = document.getElementById("dash-streamed-week");
const dashCreditsUsed = document.getElementById("dash-credits-used");
const dashSessions = document.getElementById("dash-sessions");
const dashSessionsTableBody = document.querySelector("#dash-sessions-table tbody");

const walletCurrentBalance = document.getElementById("wallet-current-balance");
const walletCurrentBalanceTimeEl = document.getElementById("wallet-current-balance-time");
const walletTotalToppedUp = document.getElementById("wallet-total-topped-up");
const walletCreditsPurchased = document.getElementById("wallet-credits-purchased");
const recentTopupsTableBody = document.querySelector("#recent-topups-table tbody");

const billingTotalSpent = document.getElementById("billing-total-spent");
const billingCreditsPurchased = document.getElementById("billing-credits-purchased");
const billingTransactionCount = document.getElementById("billing-transaction-count");
const ledgerTableBody = document.querySelector("#ledger-table tbody");

const settingsEmail = document.getElementById("settings-email");
const passwordForm = document.getElementById("password-form");
const newPasswordInput = document.getElementById("new-password");
const deleteAccountConfirmInput = document.getElementById("delete-account-confirm");
const deleteAccountBtn = document.getElementById("delete-account-btn");
const deleteAccountStatus = document.getElementById("delete-account-status");
const passwordStatus = document.getElementById("password-status");

const toastEl = document.getElementById("toast");

const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const modelSpec = getRealtimeModel();

// ---------- State ----------

let cameraStream = null;
let decartConfigured = false;
let mode = "realistic"; // "realistic" | "stylized"
let referenceImageFile = null;
let decart = null;
let aiEffectsGeneration = 0;
let durationTimer = null;
let sessionStartedAt = null;
let accessToken = null;
let stabilizeTimer = null;
const STABILIZE_MS = 2000; // real-time video models need a moment to converge on a new identity/look — see startStreaming()
let authMode = "signin"; // "signin" | "signup" | "reset" | "recovery"

// ---------- Small UI helpers ----------

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3000);
}

function setStreamStatus(text, kind) {
  streamStatus.textContent = text;
  streamStatus.classList.remove("status-active", "status-error");
  if (kind) streamStatus.classList.add(`status-${kind}`);
}

function setHeaderStatus(text, live) {
  headerStatusText.textContent = text;
  headerStatus.classList.toggle("live", Boolean(live));
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** "~12 min streaming left" / "~45 sec streaming left" from a credit balance. */
function formatTimeLeft(credits, creditsPerSecond) {
  const totalSeconds = Math.floor(Number(credits || 0) / creditsPerSecond);
  if (totalSeconds < 60) return `≈ ${totalSeconds} sec streaming left`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `≈ ${minutes} min streaming left` : `≈ ${minutes} min ${seconds} sec streaming left`;
}

// ---------- Auth ----------

const AUTH_COPY = {
  signin: { heading: "Sign in", sub: "Sign in to start streaming.", submit: "Sign in" },
  signup: { heading: "Create your account", sub: "Create an account to start streaming.", submit: "Create account" },
  reset: { heading: "Reset your password", sub: "Enter your email and we'll send you a reset link.", submit: "Send reset link" },
  recovery: { heading: "Set a new password", sub: "Choose a new password for your account.", submit: "Update password" },
};

function setAuthMode(newMode) {
  authMode = newMode;
  const copy = AUTH_COPY[authMode];
  authHeading.textContent = copy.heading;
  authSubheading.textContent = copy.sub;
  authSubmitBtn.textContent = copy.submit;

  // A `required` field inside a hidden container can't be focused, so
  // browsers silently refuse to submit the form at all when it's invalid —
  // no error, no event, nothing (bit us once already with the terms
  // checkbox). Every field below only gets `required` while actually visible.
  authEmailField.hidden = authMode === "recovery";
  authEmailInput.required = authMode !== "recovery";

  authPasswordField.hidden = authMode === "reset";
  authPasswordInput.required = authMode !== "reset";

  authForgotBtn.hidden = authMode !== "signin";
  authTermsRow.hidden = authMode !== "signup";
  authTermsCheckbox.required = authMode === "signup";

  authToggleModeBtn.hidden = authMode === "recovery";
  authToggleModeBtn.textContent =
    authMode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up";

  authError.hidden = true;
}
setAuthMode("signin");

authToggleModeBtn.addEventListener("click", () => {
  setAuthMode(authMode === "signup" ? "signin" : authMode === "signin" ? "signup" : "signin");
});

authForgotBtn.addEventListener("click", () => setAuthMode("reset"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmitBtn.disabled = true;

  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  const originalLabel = authSubmitBtn.textContent;
  authSubmitBtn.textContent = "Please wait...";

  try {
    if (authMode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/",
      });
      if (error) throw error;
      showToast("Check your email for a password reset link.");
      setAuthMode("signin");
      return;
    }

    if (authMode === "recovery") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      const { data: sessionData } = await supabase.auth.getSession();
      showToast("Password updated.");
      if (sessionData.session) await showAuthedUI(sessionData.session);
      return;
    }

    const { data, error } =
      authMode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (error) throw error;

    if (authMode === "signup") {
      if (data.session) {
        // Email confirmation is off for this project — we're signed in
        // immediately, so don't wait on a confirmation step that isn't
        // coming.
        await showAuthedUI(data.session);
      } else {
        showToast("Account created — check your inbox to confirm your email, then sign in.");
        setAuthMode("signin");
      }
    } else if (data.session) {
      // Don't rely solely on onAuthStateChange to update the UI — it should
      // fire, but using the session we already have in hand is more direct
      // and avoids the UI silently never updating if it doesn't.
      await showAuthedUI(data.session);
    } else {
      throw new Error("Signed in, but no session was returned. Please try again.");
    }
  } catch (err) {
    console.error("Auth error", err);
    authError.hidden = false;
    authError.textContent = err?.message || "Something went wrong. Please try again.";
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalLabel;
  }
});

signOutBtn.addEventListener("click", async () => {
  if (decart?.isActive) await stopStreaming();
  await supabase.auth.signOut();
});

let currentUser = null;
let cachedCreditsPerSecond = null;

async function getCachedCreditsPerSecond() {
  if (cachedCreditsPerSecond) return cachedCreditsPerSecond;
  const { data } = await supabase.from("pricing_config").select("credits_per_second").eq("id", 1).single();
  cachedCreditsPerSecond = Number(data?.credits_per_second) || 2;
  return cachedCreditsPerSecond;
}

async function showAuthedUI(session) {
  accessToken = session.access_token;
  currentUser = session.user;
  authScreen.hidden = true;
  appShell.hidden = false;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
  adminLink.hidden = profile?.role !== "admin";

  await refreshWallet();
  openPanel("dashboard");
}

function showSignedOutUI() {
  accessToken = null;
  currentUser = null;
  authScreen.hidden = false;
  appShell.hidden = true;
}

async function refreshWallet() {
  if (!accessToken) return;
  try {
    const res = await fetch(apiUrl("/api/wallet"), { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.json();
    if (res.ok) {
      walletBalanceEl.textContent = body.balanceCredits;
      const rate = await getCachedCreditsPerSecond();
      walletBalanceTimeEl.textContent = formatTimeLeft(body.balanceCredits, rate);
      updateLowBalanceWarning(body.balanceCredits, rate);
    }
  } catch (err) {
    console.warn("Could not refresh wallet", err);
  }
}

if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((event, session) => {
    // Clicking the emailed reset link signs the user into a temporary
    // recovery session — show the "set a new password" form instead of
    // dropping them straight into the dashboard with a password they
    // never chose.
    if (event === "PASSWORD_RECOVERY") {
      authScreen.hidden = false;
      appShell.hidden = true;
      setAuthMode("recovery");
      return;
    }
    if (session) showAuthedUI(session);
    else showSignedOutUI();
  });
} else {
  authError.hidden = false;
  authError.textContent = "Accounts are not configured on this deployment.";
}

// ---------- Panel navigation ----------
//
// All the reads below query Supabase directly with the signed-in user's own
// session (the anon key), never our server — Row Level Security on each
// table only ever returns that user's own rows (see server/schema.sql), so
// there's no way for this code to leak another user's wallet, sessions, or
// transactions even if it tried to.

function openPanel(name) {
  appNav.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  document.querySelectorAll(".app-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  panelTitle.textContent = panelLabels[name] || name;

  if (name === "dashboard") loadDashboard();
  else if (name === "wallet") loadWalletPanel();
  else if (name === "billing") loadBillingPanel();
  else if (name === "settings") loadSettingsPanel();
}

appNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".admin-nav-item");
  if (!btn) return;
  openPanel(btn.dataset.panel);
});

sidebarTopupBtn.addEventListener("click", () => openPanel("wallet"));

// ---------- Dashboard ----------

async function loadDashboard() {
  if (!currentUser) return;
  const creditsPerSecond = await getCachedCreditsPerSecond();

  const [{ data: wallet }, { data: transactions }, { data: sessions }] = await Promise.all([
    supabase.from("wallets").select("balance_credits").eq("user_id", currentUser.id).single(),
    supabase
      .from("transactions")
      .select("type, credits, status, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("stream_sessions")
      .select("started_at, credits_charged, status")
      .eq("user_id", currentUser.id)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  dashBalance.textContent = wallet?.balance_credits ?? 0;
  dashBalanceTimeEl.textContent = formatTimeLeft(wallet?.balance_credits, creditsPerSecond);

  const usageTx = (transactions || []).filter((t) => t.type === "stream_usage" && t.status === "completed");
  const totalCreditsUsed = usageTx.reduce((sum, t) => sum + Math.abs(t.credits), 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCredits = usageTx
    .filter((t) => new Date(t.created_at).getTime() >= weekAgo)
    .reduce((sum, t) => sum + Math.abs(t.credits), 0);

  dashStreamedWeek.textContent = formatDuration((weekCredits / creditsPerSecond) * 1000);
  dashCreditsUsed.textContent = totalCreditsUsed.toLocaleString();
  dashSessions.textContent = usageTx.length;

  dashSessionsTableBody.innerHTML =
    (sessions || [])
      .map((s) => {
        const seconds = Math.round(Number(s.credits_charged || 0) / creditsPerSecond);
        return `<tr>
          <td>${new Date(s.started_at).toLocaleString()}</td>
          <td>${formatDuration(seconds * 1000)}</td>
          <td>${s.credits_charged}</td>
          <td>${s.status}</td>
        </tr>`;
      })
      .join("") || '<tr><td colspan="4" class="hint">No sessions yet.</td></tr>';
}

// ---------- Wallet ----------

async function loadPacks() {
  packListEl.innerHTML = "";
  const { data: packs, error } = await supabase
    .from("packs")
    .select("id, name, credits, price_ngn")
    .eq("active", true)
    .order("sort_order");
  if (error || !packs) {
    packListEl.innerHTML = `<p class="hint status-text status-error">Could not load packs.</p>`;
    return;
  }
  const rate = await getCachedCreditsPerSecond();

  packs.forEach((pack) => {
    const seconds = Math.floor(pack.credits / rate);
    const minutes = Math.floor(seconds / 60);
    const item = document.createElement("div");
    item.className = "pack-item";
    item.innerHTML = `
      <div class="pack-item-info">
        <span class="pack-item-name">${pack.name}</span>
        <span class="pack-item-meta">${pack.credits} credits · ≈ ${minutes} min streaming</span>
      </div>
      <span class="pack-item-price">₦${pack.price_ngn.toLocaleString()}</span>
      <button type="button" class="btn btn-primary btn-sm" data-pack-id="${pack.id}">Buy</button>
    `;
    packListEl.appendChild(item);
  });
}

packListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-pack-id]");
  if (!btn) return;
  btn.disabled = true;
  topupStatus.textContent = "Starting checkout...";
  topupStatus.classList.remove("status-error");
  try {
    const res = await fetch(apiUrl("/api/wallet/topup"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ packId: btn.dataset.packId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not start checkout.");
    window.location.href = body.checkoutUrl;
  } catch (err) {
    topupStatus.textContent = err.message;
    topupStatus.classList.add("status-error");
    btn.disabled = false;
  }
});

async function loadWalletPanel() {
  if (!currentUser) return;
  const [{ data: wallet }, { data: topups }, rate] = await Promise.all([
    supabase.from("wallets").select("balance_credits").eq("user_id", currentUser.id).single(),
    supabase
      .from("transactions")
      .select("credits, amount_ngn, status, created_at")
      .eq("user_id", currentUser.id)
      .eq("type", "topup")
      .order("created_at", { ascending: false })
      .limit(50),
    getCachedCreditsPerSecond(),
  ]);

  walletCurrentBalance.textContent = wallet?.balance_credits ?? 0;
  walletCurrentBalanceTimeEl.textContent = formatTimeLeft(wallet?.balance_credits, rate);

  const completed = (topups || []).filter((t) => t.status === "completed");
  const totalToppedUp = completed.reduce((sum, t) => sum + (t.amount_ngn || 0), 0);
  const creditsPurchased = completed.reduce((sum, t) => sum + t.credits, 0);

  walletTotalToppedUp.textContent = "₦" + totalToppedUp.toLocaleString();
  walletCreditsPurchased.textContent = creditsPurchased.toLocaleString();

  recentTopupsTableBody.innerHTML =
    (topups || [])
      .slice(0, 10)
      .map(
        (t) => `<tr>
          <td>${new Date(t.created_at).toLocaleString()}</td>
          <td>${t.credits}</td>
          <td>₦${(t.amount_ngn || 0).toLocaleString()}</td>
          <td>${t.status}</td>
        </tr>`
      )
      .join("") || '<tr><td colspan="4" class="hint">No top-ups yet.</td></tr>';

  topupStatus.textContent = "";
  await loadPacks();
}

// Korapay redirects back here after checkout — refresh the balance (the
// webhook is what actually credited it, this just re-fetches to show it).
if (new URLSearchParams(window.location.search).get("topup") === "complete") {
  showToast("Payment received — refreshing balance...");
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(() => {
    refreshWallet();
    if (document.querySelector('.admin-nav-item[data-panel="wallet"]')?.classList.contains("active")) {
      loadWalletPanel();
    }
  }, 1500);
}

// ---------- Billing ----------

async function loadBillingPanel() {
  if (!currentUser) return;
  const { data: transactions } = await supabase
    .from("transactions")
    .select("type, credits, amount_ngn, status, created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const topups = (transactions || []).filter((t) => t.type === "topup" && t.status === "completed");
  const totalSpent = topups.reduce((sum, t) => sum + (t.amount_ngn || 0), 0);
  const creditsPurchased = topups.reduce((sum, t) => sum + t.credits, 0);

  billingTotalSpent.textContent = "₦" + totalSpent.toLocaleString();
  billingCreditsPurchased.textContent = creditsPurchased.toLocaleString();
  billingTransactionCount.textContent = (transactions || []).length;

  ledgerTableBody.innerHTML =
    (transactions || [])
      .map(
        (t) => `<tr>
          <td>${new Date(t.created_at).toLocaleString()}</td>
          <td>${t.type}</td>
          <td>${t.credits}</td>
          <td>${t.amount_ngn ? "₦" + t.amount_ngn.toLocaleString() : "—"}</td>
          <td>${t.status}</td>
        </tr>`
      )
      .join("") || '<tr><td colspan="5" class="hint">No transactions yet.</td></tr>';
}

// ---------- Settings ----------

function loadSettingsPanel() {
  settingsEmail.textContent = currentUser?.email || "";
}

passwordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  passwordStatus.textContent = "Updating...";
  passwordStatus.classList.remove("status-error", "status-active");
  try {
    // Supabase Auth's own secure endpoint — operates on the caller's own
    // active session, so this can only ever change the signed-in user's own
    // password.
    const { error } = await supabase.auth.updateUser({ password: newPasswordInput.value });
    if (error) throw error;
    passwordStatus.textContent = "Password updated.";
    passwordStatus.classList.add("status-active");
    passwordForm.reset();
  } catch (err) {
    passwordStatus.textContent = err.message;
    passwordStatus.classList.add("status-error");
  }
});

deleteAccountBtn.addEventListener("click", async () => {
  const typed = deleteAccountConfirmInput.value.trim().toLowerCase();
  if (!typed || typed !== (currentUser?.email || "").toLowerCase()) {
    deleteAccountStatus.textContent = "Type your account email exactly to confirm.";
    deleteAccountStatus.classList.add("status-error");
    deleteAccountStatus.classList.remove("status-active");
    return;
  }
  if (!window.confirm("This permanently deletes your account and all data. Are you sure?")) return;

  deleteAccountBtn.disabled = true;
  deleteAccountStatus.textContent = "Deleting...";
  deleteAccountStatus.classList.remove("status-error", "status-active");
  try {
    if (decart?.isActive) await stopStreaming();
    const res = await fetch(apiUrl("/api/account"), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not delete account.");
    await supabase.auth.signOut();
    showToast("Your account has been deleted.");
  } catch (err) {
    deleteAccountStatus.textContent = err.message;
    deleteAccountStatus.classList.add("status-error");
    deleteAccountBtn.disabled = false;
  }
});

// ---------- OBS URL ----------

obsUrlInput.value = `${window.location.origin}/obs.html`;
copyObsUrlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(obsUrlInput.value);
    showToast("OBS Browser Source URL copied");
  } catch {
    obsUrlInput.select();
    showToast("Select and copy the URL above");
  }
});

// ---------- Camera ----------

async function refreshCameras() {
  try {
    const { cameras } = await listDevices();
    cameraSelect.innerHTML = cameras
      .map((d, i) => `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`)
      .join("");
  } catch (err) {
    console.warn("Could not list cameras", err);
  }
}

async function enableCamera() {
  try {
    stopStream(cameraStream);
    cameraStream = await getLocalStream({
      cameraId: cameraSelect.value || undefined,
      video: { width: modelSpec.width, height: modelSpec.height, frameRate: modelSpec.fps },
      audio: false,
    });
    cameraPreview.srcObject = cameraStream;
    cameraPlaceholder.hidden = true;
    await refreshCameras();
  } catch (err) {
    console.warn(err);
    showToast("Camera permission needed: " + err.message);
  }
}

enableCameraBtn.addEventListener("click", enableCamera);
cameraSelect.addEventListener("change", async () => {
  const wasStreaming = decart?.isActive;
  if (wasStreaming) await stopStreaming();
  await enableCamera();
  if (wasStreaming) await startStreaming();
});

// ---------- Mode toggle ----------

modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  mode = btn.dataset.mode;
  modeToggle.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
  realisticControls.hidden = mode !== "realistic";
  stylizedControls.hidden = mode !== "stylized";
  syncLiveState();
});

realismSlider.addEventListener("input", () => {
  realismValue.textContent = realismSlider.value;
});
realismSlider.addEventListener("change", syncLiveState);

presetGrid.addEventListener("click", (e) => {
  const chip = e.target.closest(".preset-chip");
  if (!chip) return;
  aiPromptInput.value = chip.dataset.prompt;
  document.querySelectorAll(".preset-chip").forEach((c) => c.classList.toggle("active", c === chip));
  if (chip.dataset.requiresImage && !referenceImageFile) {
    showToast("Upload a reference photo below for this effect to swap in that person.");
  }
  syncLiveState();
});
aiPromptInput.addEventListener("change", syncLiveState);
aiEnhanceInput.addEventListener("change", syncLiveState);

// Our own interpretation of a "realism" dial on top of Lucy 2.5's plain
// prompt/enhance API (there's no native realism parameter).
//
// These two variants mean different things and must not be mixed: with no
// reference image, higher values mean "stay closer to my own untouched
// face." With a reference image, the person is already being replaced, so
// "stay close to the untouched camera feed" directly contradicts the swap
// instruction — the model ends up honoring neither, landing on a third,
// unrelated face (the exact "wrong identity" bug this was rewritten to fix).
// With an image, higher values instead mean "integrate the reference
// person subtly/naturally" rather than "barely change the original".
function realisticPromptFor(level, hasImage) {
  if (hasImage) {
    if (level >= 8) {
      return "Blend the substituted person naturally into the scene, matching the original lighting and camera angle, so the result looks like an authentic, unedited recording of them.";
    }
    if (level >= 4) {
      return "Integrate the substituted person into the scene with moderate lighting and color adjustment to match their surroundings.";
    }
    return "Apply noticeably stylized lighting and color grading around the substituted person while keeping them clearly recognizable as the reference photo.";
  }
  if (level >= 8) {
    return "Keep the person looking completely natural and true to life. Apply only very subtle lighting and clarity enhancement — the result should be barely distinguishable from the raw camera feed.";
  }
  if (level >= 4) {
    return "Keep the person looking natural and human. Apply moderate lighting, skin, and color enhancement while fully preserving their true identity and expressions.";
  }
  return "Noticeably enhance the lighting, sharpness, and color grading, giving a polished studio look, while keeping the person clearly recognizable and natural-looking.";
}

function currentPromptAndEnhance() {
  let prompt;
  let enhance;
  if (mode === "realistic") {
    prompt = realisticPromptFor(Number(realismSlider.value), Boolean(referenceImageFile));
    enhance = true;
  } else {
    prompt = aiPromptInput.value.trim() || "Subtle cinematic color grade";
    enhance = aiEnhanceInput.checked;
  }

  // A reference image with no matching instruction is ambiguous to the
  // model — it can drift into unrelated, unstable faces instead of the one
  // supplied (worse over time, since Lucy 2.5 partly anchors to its own
  // prior output). Whenever an image is attached, always lead with an
  // explicit substitution instruction so the two stay in sync.
  if (referenceImageFile) {
    prompt = `Substitute the person in the video with the person shown in the reference image, preserving their real pose, motion, and expressions, and closely matching their hair, skin tone, and facial features. ${prompt}`;
    // "Enhance" runs our prompt through Decart's own LLM to rewrite it
    // before it reaches the video model — useful for vague prompts, but it
    // means the *actual* prompt varies slightly between connections even
    // though our input text doesn't. For a swap, where we already give a
    // specific, detailed instruction, that variance is exactly what causes
    // "sometimes locks onto the reference face fast, sometimes doesn't."
    enhance = false;
  }

  return { prompt, enhance };
}

// Pushes the current prompt/enhance to the live session, if one is running —
// called whenever anything that affects the prompt changes (mode, realism,
// preset, custom prompt, enhance toggle, or the reference image itself).
async function syncLiveState() {
  if (!decart?.isActive) return;
  const { prompt, enhance } = currentPromptAndEnhance();
  try {
    await decart.updatePrompt(prompt, enhance);
  } catch (err) {
    console.warn("Could not sync prompt to the live session", err);
  }
}

// ---------- Reference image ----------

function showImagePreview(file) {
  const url = URL.createObjectURL(file);
  aiImagePreview.onload = () => URL.revokeObjectURL(url);
  aiImagePreview.src = url;
  aiImagePreviewWrap.hidden = false;
  dropzoneEmpty.hidden = true;
  aiImageRemoveBtn.hidden = false;
}

function clearImagePreview() {
  aiImagePreview.src = "";
  aiImagePreviewWrap.hidden = true;
  dropzoneEmpty.hidden = false;
  aiImageRemoveBtn.hidden = true;
}

async function handleImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    showToast("That image is too large — please use one under 8MB.");
    return;
  }
  referenceImageFile = file;
  showImagePreview(file);

  if (decart?.isActive) {
    try {
      // Order matters: set the image first, then push a prompt that
      // actually instructs the model to use it — sending only the image
      // (or updating the prompt before the image lands) is exactly what
      // causes it to drift into unrelated, mismatched faces.
      await decart.updateImage(file);
      await syncLiveState();
      setStreamStatus("Reference image updated — live.", "active");
    } catch (err) {
      setStreamStatus("Could not apply reference image: " + err.message, "error");
    }
  }
}

browseImageBtn.addEventListener("click", () => aiImageInput.click());
aiImageInput.addEventListener("change", () => handleImageFile(aiImageInput.files?.[0]));

aiImageRemoveBtn.addEventListener("click", async () => {
  referenceImageFile = null;
  aiImageInput.value = "";
  clearImagePreview();
  if (decart?.isActive) {
    try {
      await decart.updateImage(null);
      await syncLiveState();
    } catch (err) {
      console.warn(err);
    }
  }
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleImageFile(file);
});

// ---------- Stream-session relay (so the OBS output page can find us) ----------

async function publishStreamSession(subscribeToken) {
  try {
    await fetch(apiUrl("/api/stream-session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscribeToken, model: "lucy-2.5" }),
    });
  } catch (err) {
    console.warn("Could not publish stream session", err);
  }
}

function clearStreamSession() {
  fetch(apiUrl("/api/stream-session"), { method: "DELETE", keepalive: true }).catch(() => {});
}

window.addEventListener("beforeunload", clearStreamSession);

// ---------- Duration timer ----------

function startDurationTimer() {
  sessionStartedAt = Date.now();
  clearInterval(durationTimer);
  durationTimer = setInterval(() => {
    sessionDurationEl.textContent = formatDuration(Date.now() - sessionStartedAt);
  }, 1000);
}

function stopDurationTimer() {
  clearInterval(durationTimer);
  durationTimer = null;
  sessionDurationEl.textContent = "00:00";
}

// ---------- Start / stop streaming ----------

async function checkDecartAvailability() {
  try {
    const res = await fetch(apiUrl("/api/health"));
    const body = await res.json();
    decartConfigured = Boolean(body.decartConfigured);
  } catch {
    decartConfigured = false;
  }
  if (!decartConfigured) {
    setStreamStatus("AI effects are disabled — set DECART_API_KEY on the server and restart it.", "error");
    streamToggleBtn.disabled = true;
  }
}

async function startStreaming() {
  if (!decartConfigured || !cameraStream) return;
  if (!accessToken) {
    setStreamStatus("Sign in to start streaming.", "error");
    return;
  }
  const myGeneration = ++aiEffectsGeneration;
  const { prompt, enhance } = currentPromptAndEnhance();

  // Viewers (OBS) find us by polling the server for a published
  // subscribeToken — so holding that publish until stabilization completes
  // means a viewer can never subscribe into the rough warm-up frames in the
  // first place, not just have them hidden in our own local preview.
  let pendingSubscribeToken = null;
  let stabilized = false;

  function publishWhenReady() {
    if (stabilized && pendingSubscribeToken) {
      publishStreamSession(pendingSubscribeToken);
      obsLiveBadge.hidden = false;
    }
  }

  const instance = new DecartEffects();
  instance.addEventListener("stream", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    outputPreview.srcObject = e.detail.stream;
    // Real-time video models take a moment to converge on a new identity —
    // the first frames after (re)connecting can show a rough or unrelated
    // face. Keep the placeholder up over the (already-playing) feed for a
    // couple seconds so viewers only ever see the settled result, rather
    // than exposing that warm-up period.
    outputPlaceholder.hidden = false;
    outputPlaceholder.textContent = "Stabilizing output...";
    setStreamStatus("Connecting to Lucy 2.5...");
    clearTimeout(stabilizeTimer);
    stabilizeTimer = setTimeout(() => {
      if (myGeneration !== aiEffectsGeneration) return;
      outputPlaceholder.hidden = true;
      setStreamStatus("Lucy 2.5 is live.", "active");
      sessionStatusEl.textContent = "Live";
      setHeaderStatus("Live", true);
      stabilized = true;
      publishWhenReady();
    }, STABILIZE_MS);
  });
  instance.addEventListener("error", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    const err = e.detail.error;
    console.error("Decart error", err);
    setStreamStatus(`AI effects error${err?.code ? ` [${err.code}]` : ""}: ${err?.message || "connection issue"}`, "error");
  });
  instance.addEventListener("usage", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    sessionUsageEl.textContent = `${e.detail.seconds}s`;
  });
  instance.addEventListener("subscribe-token", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    pendingSubscribeToken = e.detail.subscribeToken;
    publishWhenReady();
  });
  instance.addEventListener("balance", async (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    walletBalanceEl.textContent = e.detail.balance;
    const rate = await getCachedCreditsPerSecond();
    walletBalanceTimeEl.textContent = formatTimeLeft(e.detail.balance, rate);
    updateLowBalanceWarning(e.detail.balance, rate);
  });
  instance.addEventListener("billed", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    showToast(`Charged ${e.detail.creditsCharged} credits for ${e.detail.secondsUsed}s of streaming.`);
    refreshWallet();
  });

  setStreamStatus("Connecting to Lucy 2.5...");
  streamToggleBtn.disabled = true;
  try {
    await instance.start(cameraStream, { prompt, enhance, image: referenceImageFile, accessToken });
  } catch (err) {
    if (myGeneration === aiEffectsGeneration) {
      console.error(err);
      setStreamStatus("Could not start stream: " + err.message, "error");
    } else {
      instance.stop();
    }
    streamToggleBtn.disabled = false;
    return;
  }

  if (myGeneration !== aiEffectsGeneration) {
    instance.stop();
    streamToggleBtn.disabled = false;
    return;
  }

  decart = instance;
  streamToggleBtn.textContent = "Stop stream";
  streamToggleBtn.classList.add("active");
  streamToggleBtn.disabled = false;
  startDurationTimer();
}

async function stopStreaming() {
  aiEffectsGeneration++;
  clearTimeout(stabilizeTimer);
  if (decart) {
    await decart.stop();
    decart = null;
  }
  clearStreamSession();
  obsLiveBadge.hidden = true;
  outputPreview.srcObject = null;
  outputPlaceholder.hidden = false;
  outputPlaceholder.textContent = "Your transformed feed appears here";
  streamToggleBtn.textContent = "Start stream";
  streamToggleBtn.classList.remove("active");
  setStreamStatus("Idle — not streaming.");
  sessionStatusEl.textContent = "Idle";
  sessionUsageEl.textContent = "0s";
  setHeaderStatus("Idle — not streaming", false);
  stopDurationTimer();
}

streamToggleBtn.addEventListener("click", () => {
  if (decart?.isActive) stopStreaming();
  else startStreaming();
});


// ---------- Boot ----------

(async function boot() {
  if (!isWebRTCSupported()) {
    setStreamStatus("This browser doesn't support camera capture.", "error");
    streamToggleBtn.disabled = true;
    return;
  }
  await checkDecartAvailability();
  await refreshCameras();
})();
