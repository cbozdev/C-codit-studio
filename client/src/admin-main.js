import "./style.css";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { apiUrl } from "./api.js";

const gateScreen = document.getElementById("gate-screen");
const gateMessage = document.getElementById("gate-message");
const adminScreen = document.getElementById("admin-screen");

const creditsPerSecondInput = document.getElementById("credits-per-second");
const decartCostPerSecondInput = document.getElementById("decart-cost-per-second");
const usdToNgnRateInput = document.getElementById("usd-to-ngn-rate");
const savePricingBtn = document.getElementById("save-pricing-btn");
const pricingStatus = document.getElementById("pricing-status");
let currentPricing = null;

const packListEl = document.getElementById("admin-pack-list");
const packStatus = document.getElementById("pack-status");
const newPackForm = document.getElementById("new-pack-form");
const newPackName = document.getElementById("new-pack-name");
const newPackCredits = document.getElementById("new-pack-credits");
const newPackPrice = document.getElementById("new-pack-price");

const adjustModal = document.getElementById("adjust-modal");
const closeAdjustBtn = document.getElementById("close-adjust-btn");
const adjustUserEmail = document.getElementById("adjust-user-email");
const adjustForm = document.getElementById("adjust-form");
const adjustAmount = document.getElementById("adjust-amount");
const adjustNote = document.getElementById("adjust-note");
const adjustStatus = document.getElementById("adjust-status");
let adjustTargetUserId = null;

const usersTableBody = document.querySelector("#users-table tbody");
const transactionsTableBody = document.querySelector("#transactions-table tbody");
const recentTableBody = document.querySelector("#recent-table tbody");

const adminNav = document.getElementById("admin-nav");
const panelTitle = document.getElementById("panel-title");
const adminEmailEl = document.getElementById("admin-email");
const panelLabels = {
  dashboard: "Dashboard",
  pricing: "Pricing",
  packs: "Top-up packs",
  users: "Users",
  transactions: "Transactions",
};

adminNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".admin-nav-item");
  if (!btn) return;
  const panel = btn.dataset.panel;
  adminNav.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".admin-panel").forEach((p) => (p.hidden = p.dataset.panel !== panel));
  panelTitle.textContent = panelLabels[panel] || panel;
});

const statUsers = document.getElementById("stat-users");
const statRevenue = document.getElementById("stat-revenue");
const statCredits = document.getElementById("stat-credits");
const statPacks = document.getElementById("stat-packs");
const statCost = document.getElementById("stat-cost");
const statProfit = document.getElementById("stat-profit");
const statMargin = document.getElementById("stat-margin");

function renderTransactionRows(transactions) {
  return transactions
    .map(
      (t) => `
      <tr>
        <td${t.note ? ` title="${t.note.replace(/"/g, "&quot;")}"` : ""}>${t.type}</td>
        <td>${t.credits}</td>
        <td>${t.amount_ngn ? "₦" + t.amount_ngn.toLocaleString() : "—"}</td>
        <td>${t.status}</td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      </tr>`
    )
    .join("");
}

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
  if (res.ok) {
    currentPricing = body;
    creditsPerSecondInput.value = body.credits_per_second;
    decartCostPerSecondInput.value = body.decart_cost_per_second_usd;
    usdToNgnRateInput.value = body.usd_to_ngn_rate;
  }
}

savePricingBtn.addEventListener("click", async () => {
  pricingStatus.textContent = "Saving...";
  pricingStatus.classList.remove("status-error", "status-active");
  try {
    const res = await authedFetch("/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        creditsPerSecond: Number(creditsPerSecondInput.value),
        decartCostPerSecondUsd: Number(decartCostPerSecondInput.value),
        usdToNgnRate: Number(usdToNgnRateInput.value),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    pricingStatus.textContent = "Saved.";
    pricingStatus.classList.add("status-active");
    await loadPricing();
    await loadOverview();
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
  statPacks.textContent = packs.filter((p) => p.active).length;
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
    .map((u) => {
      const balance = u.wallets?.[0]?.balance_credits ?? u.wallets?.balance_credits ?? "—";
      return `
      <tr>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td>${balance}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-adjust-id="${u.id}" data-adjust-email="${u.email}">Adjust</button></td>
      </tr>`;
    })
    .join("");

  transactionsTableBody.innerHTML = renderTransactionRows(body.transactions);
  recentTableBody.innerHTML = renderTransactionRows(body.transactions.slice(0, 10));

  const revenue = body.transactions
    .filter((t) => t.type === "topup" && t.status === "completed")
    .reduce((sum, t) => sum + (t.amount_ngn || 0), 0);
  const creditsInCirculation = body.users.reduce(
    (sum, u) => sum + Number(u.wallets?.[0]?.balance_credits ?? u.wallets?.balance_credits ?? 0),
    0
  );
  statUsers.textContent = body.users.length;
  statRevenue.textContent = "₦" + revenue.toLocaleString();
  statCredits.textContent = creditsInCirculation.toLocaleString();

  if (currentPricing) {
    const creditsUsed = body.transactions
      .filter((t) => t.type === "stream_usage")
      .reduce((sum, t) => sum + Math.abs(t.credits || 0), 0);
    const secondsBilled = creditsUsed / currentPricing.credits_per_second;
    const costNgn = secondsBilled * currentPricing.decart_cost_per_second_usd * currentPricing.usd_to_ngn_rate;
    const profit = revenue - costNgn;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    statCost.textContent = "₦" + costNgn.toLocaleString(undefined, { maximumFractionDigits: 0 });
    statProfit.textContent = "₦" + profit.toLocaleString(undefined, { maximumFractionDigits: 0 });
    statProfit.classList.toggle("stat-negative", profit < 0);
    statMargin.textContent = margin.toFixed(1) + "%";
    statMargin.classList.toggle("stat-negative", margin < 0);
  }
}

usersTableBody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-adjust-id]");
  if (!btn) return;
  adjustTargetUserId = btn.dataset.adjustId;
  adjustUserEmail.textContent = btn.dataset.adjustEmail;
  adjustAmount.value = "";
  adjustNote.value = "";
  adjustStatus.textContent = "";
  adjustStatus.classList.remove("status-error", "status-active");
  adjustModal.hidden = false;
});

closeAdjustBtn.addEventListener("click", () => (adjustModal.hidden = true));
adjustModal.addEventListener("click", (e) => {
  if (e.target === adjustModal) adjustModal.hidden = true;
});

adjustForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(adjustAmount.value);
  if (!Number.isInteger(amount) || amount === 0) {
    adjustStatus.textContent = "Enter a non-zero whole number.";
    adjustStatus.classList.add("status-error");
    return;
  }
  adjustStatus.textContent = "Applying...";
  adjustStatus.classList.remove("status-error", "status-active");
  try {
    const res = await authedFetch(`/api/admin/users/${adjustTargetUserId}/adjust-balance`, {
      method: "POST",
      body: JSON.stringify({ amount, note: adjustNote.value.trim() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    adjustStatus.textContent = `Done — new balance: ${body.balance}.`;
    adjustStatus.classList.add("status-active");
    await loadOverview();
    setTimeout(() => (adjustModal.hidden = true), 900);
  } catch (err) {
    adjustStatus.textContent = err.message;
    adjustStatus.classList.add("status-error");
  }
});

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
  adminEmailEl.textContent = session.user.email;
  gateScreen.hidden = true;
  adminScreen.hidden = false;

  await loadPricing();
  await Promise.all([loadPacks(), loadOverview()]);
}

boot();
