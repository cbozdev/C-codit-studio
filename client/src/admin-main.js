import "./style.css";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { apiUrl } from "./api.js";

const gateScreen = document.getElementById("gate-screen");
const gateMessage = document.getElementById("gate-message");
const adminScreen = document.getElementById("admin-screen");

const creditsPerSecondInput = document.getElementById("credits-per-second");
const savePricingBtn = document.getElementById("save-pricing-btn");
const pricingStatus = document.getElementById("pricing-status");

const packListEl = document.getElementById("admin-pack-list");
const packStatus = document.getElementById("pack-status");
const newPackForm = document.getElementById("new-pack-form");
const newPackName = document.getElementById("new-pack-name");
const newPackCredits = document.getElementById("new-pack-credits");
const newPackPrice = document.getElementById("new-pack-price");

const usersTableBody = document.querySelector("#users-table tbody");
const transactionsTableBody = document.querySelector("#transactions-table tbody");

const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3000);
}

let accessToken = null;

function authedFetch(path, options = {}) {
  return fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
}

async function loadPricing() {
  const res = await authedFetch("/api/admin/pricing");
  const body = await res.json();
  if (res.ok) creditsPerSecondInput.value = body.credits_per_second;
}

savePricingBtn.addEventListener("click", async () => {
  pricingStatus.textContent = "Saving...";
  pricingStatus.classList.remove("status-error", "status-active");
  try {
    const res = await authedFetch("/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({ creditsPerSecond: Number(creditsPerSecondInput.value) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    pricingStatus.textContent = "Saved.";
    pricingStatus.classList.add("status-active");
  } catch (err) {
    pricingStatus.textContent = err.message;
    pricingStatus.classList.add("status-error");
  }
});

function packRow(pack) {
  const row = document.createElement("div");
  row.className = "pack-item";
  row.innerHTML = `
    <div class="pack-item-editable">
      <input type="text" data-field="name" value="${pack.name}" />
      <input type="number" data-field="credits" value="${pack.credits}" min="1" />
      <input type="number" data-field="priceNgn" value="${pack.price_ngn}" min="1" />
      <label class="switch"><input type="checkbox" data-field="active" ${pack.active ? "checked" : ""} /><span>Active</span></label>
      <button type="button" class="btn btn-ghost btn-sm" data-save-id="${pack.id}">Save</button>
    </div>
  `;
  return row;
}

async function loadPacks() {
  const res = await authedFetch("/api/admin/packs");
  const packs = await res.json();
  packListEl.innerHTML = "";
  if (!res.ok) {
    packStatus.textContent = "Could not load packs.";
    packStatus.classList.add("status-error");
    return;
  }
  packs.forEach((pack) => packListEl.appendChild(packRow(pack)));
}

packListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-save-id]");
  if (!btn) return;
  const row = btn.closest(".pack-item");
  const patch = {
    name: row.querySelector('[data-field="name"]').value,
    credits: Number(row.querySelector('[data-field="credits"]').value),
    priceNgn: Number(row.querySelector('[data-field="priceNgn"]').value),
    active: row.querySelector('[data-field="active"]').checked,
  };
  btn.disabled = true;
  try {
    const res = await authedFetch(`/api/admin/packs/${btn.dataset.saveId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast("Pack updated.");
  } catch (err) {
    showToast("Could not update pack: " + err.message);
  }
  btn.disabled = false;
});

newPackForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await authedFetch("/api/admin/packs", {
      method: "POST",
      body: JSON.stringify({
        name: newPackName.value,
        credits: Number(newPackCredits.value),
        priceNgn: Number(newPackPrice.value),
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    newPackForm.reset();
    await loadPacks();
    showToast("Pack added.");
  } catch (err) {
    packStatus.textContent = err.message;
    packStatus.classList.add("status-error");
  }
});

async function loadOverview() {
  const res = await authedFetch("/api/admin/overview");
  const body = await res.json();
  if (!res.ok) return;

  usersTableBody.innerHTML = body.users
    .map(
      (u) => `
      <tr>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td>${u.wallets?.[0]?.balance_credits ?? u.wallets?.balance_credits ?? "—"}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
      </tr>`
    )
    .join("");

  transactionsTableBody.innerHTML = body.transactions
    .map(
      (t) => `
      <tr>
        <td>${t.type}</td>
        <td>${t.credits}</td>
        <td>${t.amount_ngn ? "₦" + t.amount_ngn.toLocaleString() : "—"}</td>
        <td>${t.status}</td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      </tr>`
    )
    .join("");
}

async function boot() {
  if (!isSupabaseConfigured) {
    gateMessage.textContent = "Accounts are not configured on this deployment.";
    return;
  }
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    gateMessage.innerHTML = 'Please <a href="/">sign in on the main app</a> first, then reload this page.';
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role !== "admin") {
    gateMessage.textContent = "Your account doesn't have admin access.";
    return;
  }

  accessToken = session.access_token;
  gateScreen.hidden = true;
  adminScreen.hidden = false;

  await Promise.all([loadPricing(), loadPacks(), loadOverview()]);
}

boot();
