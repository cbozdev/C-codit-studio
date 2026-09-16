import "./style.css";
import { isWebRTCSupported, listDevices, getLocalStream, stopStream } from "./media.js";
import { DecartEffects, getRealtimeModel } from "./decart.js";
import { apiUrl } from "./api.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

// ---------- DOM ----------

const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const authHeading = document.getElementById("auth-heading");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authError = document.getElementById("auth-error");
const authToggleModeBtn = document.getElementById("auth-toggle-mode");
const authTermsRow = document.getElementById("auth-terms-row");
const authTermsCheckbox = document.getElementById("auth-terms-checkbox");

const topbar = document.getElementById("topbar");
const studioScreen = document.getElementById("studio-screen");
const walletBalanceEl = document.getElementById("wallet-balance");
const topupBtn = document.getElementById("topup-btn");
const adminLink = document.getElementById("admin-link");
const signOutBtn = document.getElementById("sign-out-btn");

const topupModal = document.getElementById("topup-modal");
const closeTopupBtn = document.getElementById("close-topup-btn");
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

const sessionStatusEl = document.getElementById("session-status");
const sessionDurationEl = document.getElementById("session-duration");
const sessionUsageEl = document.getElementById("session-usage");

const obsUrlInput = document.getElementById("obs-url");
const copyObsUrlBtn = document.getElementById("copy-obs-url");
const obsLiveBadge = document.getElementById("obs-live-badge");

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
let authMode = "signin"; // "signin" | "signup"

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

// ---------- Auth ----------

function setAuthMode(newMode) {
  authMode = newMode;
  authHeading.textContent = authMode === "signin" ? "Sign in" : "Create your account";
  authSubmitBtn.textContent = authMode === "signin" ? "Sign in" : "Create account";
  authToggleModeBtn.textContent =
    authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in";
  authTermsRow.hidden = authMode !== "signup";
  // A `required` field inside a hidden container can't be focused, so
  // browsers silently refuse to submit the form at all when it's invalid —
  // no error, no event, nothing. Only mark it required while it's actually
  // visible (signup mode).
  authTermsCheckbox.required = authMode === "signup";
  authError.hidden = true;
}
setAuthMode("signin");

authToggleModeBtn.addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmitBtn.disabled = true;

  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  const originalLabel = authSubmitBtn.textContent;
  authSubmitBtn.textContent = "Please wait...";

  try {
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

async function showAuthedUI(session) {
  accessToken = session.access_token;
  authScreen.hidden = true;
  topbar.hidden = false;
  studioScreen.hidden = false;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
  adminLink.hidden = profile?.role !== "admin";

  await refreshWallet();
}

function showSignedOutUI() {
  accessToken = null;
  authScreen.hidden = false;
  topbar.hidden = true;
  studioScreen.hidden = true;
}

async function refreshWallet() {
  if (!accessToken) return;
  try {
    const res = await fetch(apiUrl("/api/wallet"), { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.json();
    if (res.ok) walletBalanceEl.textContent = body.balanceCredits;
  } catch (err) {
    console.warn("Could not refresh wallet", err);
  }
}

if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) showAuthedUI(session);
    else showSignedOutUI();
  });
} else {
  authError.hidden = false;
  authError.textContent = "Accounts are not configured on this deployment.";
}

// ---------- Top-up ----------

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
  const { data: pricing } = await supabase.from("pricing_config").select("credits_per_second").eq("id", 1).single();
  const rate = Number(pricing?.credits_per_second || 2);

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

topupBtn.addEventListener("click", () => {
  topupModal.hidden = false;
  topupStatus.textContent = "";
  loadPacks();
});
closeTopupBtn.addEventListener("click", () => (topupModal.hidden = true));
topupModal.addEventListener("click", (e) => {
  if (e.target === topupModal) topupModal.hidden = true;
});

// Korapay redirects back here after checkout — refresh the balance (the
// webhook is what actually credited it, this just re-fetches to show it).
if (new URLSearchParams(window.location.search).get("topup") === "complete") {
  showToast("Payment received — refreshing balance...");
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(refreshWallet, 1500);
}

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
// prompt/enhance API (there's no native realism parameter) — higher values
// stay closer to an untouched, natural look; lower values push more visible
// enhancement while still keeping the person recognizable.
function realisticPromptFor(level) {
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
    prompt = realisticPromptFor(Number(realismSlider.value));
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
    prompt = `Substitute the person in the video with the person shown in the reference image, preserving their real pose, motion, and expressions. ${prompt}`;
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

  const instance = new DecartEffects();
  instance.addEventListener("stream", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    outputPreview.srcObject = e.detail.stream;
    outputPlaceholder.hidden = true;
    setStreamStatus("Lucy 2.5 is live.", "active");
    sessionStatusEl.textContent = "Live";
    setHeaderStatus("Live", true);
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
    publishStreamSession(e.detail.subscribeToken);
    obsLiveBadge.hidden = false;
  });
  instance.addEventListener("balance", (e) => {
    if (myGeneration !== aiEffectsGeneration) return;
    walletBalanceEl.textContent = e.detail.balance;
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
  if (decart) {
    await decart.stop();
    decart = null;
  }
  clearStreamSession();
  obsLiveBadge.hidden = true;
  outputPreview.srcObject = null;
  outputPlaceholder.hidden = false;
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
