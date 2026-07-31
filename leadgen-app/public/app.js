// Bump this on every meaningful change - shown in the topbar and console so
// you can immediately confirm the browser is running the build you just deployed.
const APP_VERSION = "2026.07.31-11.6";

// ---------- Diagnostics: surface failures instead of failing silently ----------
function showBanner(message) {
  let banner = document.getElementById("errorBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "errorBanner";
    banner.className = "error-banner";
    document.querySelector("main.layout").prepend(banner);
  }
  banner.textContent = message;
  banner.style.display = "block";
}

function hideBanner() {
  const banner = document.getElementById("errorBanner");
  if (banner) banner.style.display = "none";
}

// ---------- Auth-aware fetch wrapper ----------
async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  return res;
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout request failed:", err);
  } finally {
    window.location.href = "/login";
  }
});

// ---------- Settings modal (Google Places API keys, set from the UI) ----------
const navSettingsApi = document.getElementById("navSettingsApi");
const apiKeysList = document.getElementById("apiKeysList");
const newKeyLabel = document.getElementById("newKeyLabel");
const newKeyValue = document.getElementById("newKeyValue");
const settingsResult = document.getElementById("settingsResult");
const settingsTestNewBtn = document.getElementById("settingsTestNewBtn");
const settingsSaveNewBtn = document.getElementById("settingsSaveNewBtn");

function showSettingsResult(kind, text) {
  settingsResult.style.display = "block";
  settingsResult.className = `settings-result ${kind}`;
  settingsResult.textContent = text;
}

function hideSettingsResult() {
  settingsResult.style.display = "none";
}

function apiKeyRowHtml(k) {
  return `
    <div class="api-key-row ${k.active ? "active" : ""}" data-key-id="${k.id}">
      <div class="api-key-info">
        <span class="api-key-label">${k.label}</span>
        <span class="api-key-masked">${k.masked}</span>
        ${k.active ? '<span class="api-key-active-badge">● In use</span>' : ""}
        <span class="api-key-usage" title="Places API requests made / leads captured with this key">
          ${k.requestsMade} req · ${k.leadsCaught} leads
        </span>
      </div>
      <div class="api-key-actions">
        ${!k.active ? `<button type="button" class="small-btn" data-action="activate-key" data-id="${k.id}">Use this</button>` : ""}
        <button type="button" class="small-btn" data-action="test-key" data-id="${k.id}">Test</button>
        <button type="button" class="small-btn danger-btn" data-action="delete-key" data-id="${k.id}">Delete</button>
      </div>
    </div>`;
}

async function loadApiKeys() {
  apiKeysList.innerHTML = `<div class="api-keys-empty">Loading…</div>`;
  try {
    const res = await api("/api/settings/keys");
    const data = await res.json();
    if (data.keys.length === 0) {
      apiKeysList.innerHTML = data.envFallbackAvailable
        ? `<div class="api-keys-empty">No keys saved yet — currently falling back to GOOGLE_PLACES_API_KEY from .env.</div>`
        : `<div class="api-keys-empty">No keys saved yet. Add one below.</div>`;
    } else {
      apiKeysList.innerHTML = data.keys.map(apiKeyRowHtml).join("");
    }
  } catch (err) {
    apiKeysList.innerHTML = `<div class="api-keys-empty">Could not load saved keys.</div>`;
  }
}

navSettingsApi.addEventListener("click", async () => {
  newKeyLabel.value = "";
  newKeyValue.value = "";
  hideSettingsResult();
  state.lastNavSection = "settings";
  setContentView("settings-api");
  await loadApiKeys();
  await loadDailyCap();
});

async function loadDailyCap() {
  try {
    const res = await api("/api/settings/daily-cap");
    const data = await res.json();
    document.getElementById("dailyCapInput").value = data.dailyLeadCap;
  } catch (err) {
    console.error("Failed to load daily cap:", err);
  }
}

document.getElementById("dailyCapSaveBtn").addEventListener("click", async () => {
  const input = document.getElementById("dailyCapInput");
  const btn = document.getElementById("dailyCapSaveBtn");
  btn.disabled = true;
  try {
    const res = await api("/api/settings/daily-cap", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLeadCap: Number(input.value) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save");
    showSettingsResult("ok", `Daily cap set to ${data.dailyLeadCap}.`);
    await refreshQuota();
  } catch (err) {
    showSettingsResult("err", err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Backup & restore ----------
const backupResult = document.getElementById("backupResult");
function showBackupResult(kind, text) {
  backupResult.style.display = "block";
  backupResult.className = `settings-result ${kind}`;
  backupResult.textContent = text;
}

document.getElementById("backupExportBtn").addEventListener("click", async () => {
  const btn = document.getElementById("backupExportBtn");
  btn.disabled = true;
  try {
    const res = await api("/api/backup/export");
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : "xeven-leads-backup.json";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showBackupResult("ok", "Backup downloaded.");
  } catch (err) {
    showBackupResult("err", err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("backupImportInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const confirmed = await openModal({
    title: "Import this backup?",
    message: `Importing "${file.name}" will merge its niches, catch logs, and leads into your account. Nothing already here gets deleted or overwritten - only new records get added.`,
    confirmText: "Import",
  });
  e.target.value = ""; // reset the file input regardless of the choice
  if (!confirmed) return;

  showBackupResult("ok", "Reading file…");
  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    const res = await api("/api/backup/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Import failed");

    const s = data.stats;
    showBackupResult(
      "ok",
      `Imported: ${s.niches} new niche(s), ${s.catchLogs} new catch log(s), ${s.leads} new lead(s), ${s.apiKeys} new API key(s).`
    );

    // Refresh everything that could have changed
    await loadNichesAndLogs();
    await loadDailyCap();
    await loadTheme();
    await refreshQuota();
    if (state.contentView === "board") await loadLeads();
  } catch (err) {
    showBackupResult("err", err.message.includes("JSON") ? "That file doesn't look like a valid backup (couldn't parse it)." : err.message);
  }
});

// ---------- Legend info popup (Status/Needs color key) ----------
const legendInfoBtn = document.getElementById("legendInfoBtn");
const legendOverlay = document.getElementById("legendOverlay");
const legendCloseBtn = document.getElementById("legendCloseBtn");

legendInfoBtn.addEventListener("click", () => {
  legendOverlay.style.display = "flex";
});
function closeLegendModal() {
  legendOverlay.style.display = "none";
}
legendCloseBtn.addEventListener("click", closeLegendModal);
legendOverlay.addEventListener("click", (e) => {
  if (e.target === legendOverlay) closeLegendModal();
});

// ---------- Theme system (light/dark + per-color overrides, per-account) ----------
const THEME_VAR_LABELS = {
  "--bg": "Page background",
  "--panel": "Panel background",
  "--panel-raised": "Input/raised background",
  "--border": "Borders",
  "--text": "Text",
  "--text-muted": "Muted text",
  "--accent": "Accent (buttons, highlights)",
  "--accent-dim": "Accent (dim)",
  "--good": "Success / Won",
  "--warn": "Warning / Shortlisted",
  "--danger": "Danger / Rejected",
};

const DARK_THEME_DEFAULTS = {
  "--bg": "#12100e",
  "--panel": "#1b1815",
  "--panel-raised": "#221e1a",
  "--border": "#33302a",
  "--text": "#ece7dd",
  "--text-muted": "#948d80",
  "--accent": "#ff6a3d",
  "--accent-dim": "#7a3820",
  "--good": "#7fb88a",
  "--warn": "#e0b355",
  "--danger": "#d95d5d",
};

const LIGHT_THEME_DEFAULTS = {
  "--bg": "#f5f3ef",
  "--panel": "#ffffff",
  "--panel-raised": "#f0ede7",
  "--border": "#ddd7cc",
  "--text": "#1c1a17",
  "--text-muted": "#6b6459",
  "--accent": "#c94f2d",
  "--accent-dim": "#f0c4b0",
  "--good": "#2f8f52",
  "--warn": "#a8720f",
  "--danger": "#b83b3b",
};

let currentTheme = { mode: "dark", colors: { ...DARK_THEME_DEFAULTS } };

function applyTheme(theme) {
  const mode = theme && theme.mode === "light" ? "light" : "dark";
  const defaults = mode === "light" ? LIGHT_THEME_DEFAULTS : DARK_THEME_DEFAULTS;
  const overrides = (theme && theme.colors) || {};
  const merged = { ...defaults, ...overrides };
  const root = document.documentElement;
  for (const [key, val] of Object.entries(merged)) {
    root.style.setProperty(key, val);
  }
  currentTheme = { mode, colors: merged };
}

async function loadTheme() {
  try {
    const res = await api("/api/theme");
    const data = await res.json();
    applyTheme(data.theme);
  } catch (err) {
    console.error("Failed to load theme, using default:", err);
    applyTheme(null);
  }
}

const navSettingsColors = document.getElementById("navSettingsColors");
const themeColorGrid = document.getElementById("themeColorGrid");
const themeResult = document.getElementById("themeResult");
const themeSaveBtn = document.getElementById("themeSaveBtn");
const themeResetBtn = document.getElementById("themeResetBtn");

function renderThemeEditor() {
  document.querySelectorAll(".theme-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentTheme.mode);
  });

  themeColorGrid.innerHTML = Object.entries(THEME_VAR_LABELS)
    .map(
      ([cssVar, label]) => `
      <div class="theme-color-item">
        <input type="color" data-var="${cssVar}" value="${currentTheme.colors[cssVar]}" />
        <label>${label}</label>
      </div>`
    )
    .join("");

  themeColorGrid.querySelectorAll("input[type='color']").forEach((input) => {
    input.addEventListener("input", () => {
      const cssVar = input.dataset.var;
      currentTheme.colors[cssVar] = input.value;
      document.documentElement.style.setProperty(cssVar, input.value);
    });
  });
}

document.querySelectorAll(".theme-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    const defaults = mode === "light" ? LIGHT_THEME_DEFAULTS : DARK_THEME_DEFAULTS;
    currentTheme = { mode, colors: { ...defaults } };
    applyTheme(currentTheme);
    renderThemeEditor();
  });
});

navSettingsColors.addEventListener("click", async () => {
  themeResult.style.display = "none";
  state.lastNavSection = "settings";
  setContentView("settings-colors");
  await loadTheme();
  renderThemeEditor();
});

themeSaveBtn.addEventListener("click", async () => {
  themeSaveBtn.disabled = true;
  try {
    const res = await api("/api/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: currentTheme.mode, colors: currentTheme.colors }),
    });
    if (!res.ok) throw new Error("Could not save theme");
    themeResult.style.display = "block";
    themeResult.className = "settings-result ok";
    themeResult.textContent = "Saved.";
  } catch (err) {
    themeResult.style.display = "block";
    themeResult.className = "settings-result err";
    themeResult.textContent = err.message;
  } finally {
    themeSaveBtn.disabled = false;
  }
});

themeResetBtn.addEventListener("click", async () => {
  try {
    await api("/api/theme", { method: "DELETE" });
    await loadTheme();
    renderThemeEditor();
    themeResult.style.display = "block";
    themeResult.className = "settings-result ok";
    themeResult.textContent = "Reset to default.";
  } catch (err) {
    console.error("Failed to reset theme:", err);
  }
});

// ---------- Current user + admin team panel ----------
const usernameTag = document.getElementById("usernameTag");
const navSettingsTeam = document.getElementById("navSettingsTeam");
const usersList = document.getElementById("usersList");
const newUsername = document.getElementById("newUsername");
const newUserPassword = document.getElementById("newUserPassword");
const newUserIsAdmin = document.getElementById("newUserIsAdmin");
const adminResult = document.getElementById("adminResult");
const adminCreateBtn = document.getElementById("adminCreateBtn");

let currentUserId = null;

function showAdminResult(kind, text) {
  adminResult.style.display = "block";
  adminResult.className = `settings-result ${kind}`;
  adminResult.textContent = text;
}
function hideAdminResult() {
  adminResult.style.display = "none";
}

function userRowHtml(u) {
  const isSelf = u.id === currentUserId;
  return `
    <div class="user-row" data-user-id="${u.id}">
      <div class="user-row-main">
        <span class="user-row-name">${u.username}${u.role === "admin" ? '<span class="user-role-badge">admin</span>' : ""}</span>
        <span class="user-row-meta">joined ${(u.createdAt || "").slice(0, 10)}</span>
      </div>
      ${isSelf ? "" : `<button type="button" class="small-btn danger-btn" data-action="delete-user" data-id="${u.id}">Remove</button>`}
    </div>`;
}

async function loadUsers() {
  usersList.innerHTML = `<div class="api-keys-empty">Loading…</div>`;
  try {
    const res = await api("/api/users");
    const rows = await res.json();
    usersList.innerHTML = rows.map(userRowHtml).join("");
  } catch (err) {
    usersList.innerHTML = `<div class="api-keys-empty">Could not load accounts.</div>`;
  }
}

async function loadWhoami() {
  try {
    const res = await api("/api/whoami");
    const data = await res.json();
    currentUserId = data.userId;
    usernameTag.textContent = `${data.username} (${data.role})`;
    navSettingsTeam.style.display = data.role === "admin" ? "flex" : "none";
  } catch (err) {
    console.error("Failed to load current user:", err);
  }
}

navSettingsTeam.addEventListener("click", async () => {
  newUsername.value = "";
  newUserPassword.value = "";
  newUserIsAdmin.checked = false;
  hideAdminResult();
  state.lastNavSection = "settings";
  setContentView("settings-team");
  await loadUsers();
});

adminCreateBtn.addEventListener("click", async () => {
  const username = newUsername.value.trim();
  const password = newUserPassword.value;
  if (!username || !password) {
    showAdminResult("err", "Username and password are required.");
    return;
  }
  adminCreateBtn.disabled = true;
  try {
    const res = await api("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role: newUserIsAdmin.checked ? "admin" : "member" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create account");
    showAdminResult("ok", `Account "${data.username}" created. They can log in now with the password you set.`);
    newUsername.value = "";
    newUserPassword.value = "";
    newUserIsAdmin.checked = false;
    await loadUsers();
  } catch (err) {
    showAdminResult("err", err.message);
  } finally {
    adminCreateBtn.disabled = false;
  }
});

usersList.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-action="delete-user"]');
  if (!btn) return;
  const id = btn.dataset.id;
  const row = usersList.querySelector(`[data-user-id="${id}"]`);
  const username = row ? row.querySelector(".user-row-name").textContent : "this account";

  const confirmed = await openModal({
    title: `Remove ${username}?`,
    message: "This permanently deletes their account and every niche, catch log, and lead they created. This cannot be undone.",
    confirmText: "Remove",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const res = await api(`/api/users/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not remove account");
    await loadUsers();
  } catch (err) {
    showAdminResult("err", err.message);
  }
});

settingsTestNewBtn.addEventListener("click", async () => {
  const apiKey = newKeyValue.value.trim();
  if (!apiKey) {
    showSettingsResult("bad", "Paste an API key first.");
    return;
  }
  settingsTestNewBtn.disabled = true;
  settingsTestNewBtn.textContent = "Testing…";
  try {
    const res = await api("/api/settings/keys/test-value", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const data = await res.json();
    if (data.ok) {
      showSettingsResult("ok", "Success — this key works with Places API (New).");
    } else {
      showSettingsResult("bad", data.error || "That key didn't work.");
    }
  } catch (err) {
    showSettingsResult("bad", err.message || "Test failed.");
  } finally {
    settingsTestNewBtn.disabled = false;
    settingsTestNewBtn.textContent = "Test";
  }
});

settingsSaveNewBtn.addEventListener("click", async () => {
  const label = newKeyLabel.value.trim() || "Untitled key";
  const apiKey = newKeyValue.value.trim();
  if (!apiKey) {
    showSettingsResult("bad", "Paste an API key first.");
    return;
  }
  settingsSaveNewBtn.disabled = true;
  settingsSaveNewBtn.textContent = "Saving…";
  try {
    const res = await api("/api/settings/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      showSettingsResult("bad", data.error || "Could not save this key.");
      return;
    }
    showSettingsResult("ok", `Saved "${data.label}" (${data.masked}).`);
    newKeyLabel.value = "";
    newKeyValue.value = "";
    await loadApiKeys();
  } catch (err) {
    showSettingsResult("bad", err.message || "Could not save this key.");
  } finally {
    settingsSaveNewBtn.disabled = false;
    settingsSaveNewBtn.textContent = "Test & Save";
  }
});

apiKeysList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "activate-key") {
    await api(`/api/settings/keys/${id}/activate`, { method: "POST" });
    hideSettingsResult();
    await loadApiKeys();
    return;
  }

  if (action === "test-key") {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Testing…";
    try {
      const res = await api(`/api/settings/keys/${id}/test`, { method: "POST" });
      const data = await res.json();
      showSettingsResult(data.ok ? "ok" : "bad", data.ok ? "Success — this key still works." : data.error || "This key no longer works.");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
    return;
  }

  if (action === "delete-key") {
    const row = btn.closest(".api-key-row");
    const label = row.querySelector(".api-key-label").textContent;
    const confirmed = await openModal({
      title: `Delete key "${label}"?`,
      message: "This cannot be undone. If this was the active key, hunting will stop working until another key is added or activated.",
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    await api(`/api/settings/keys/${id}`, { method: "DELETE" });
    hideSettingsResult();
    await loadApiKeys();
    return;
  }
});

// ---------- Modal system (replaces browser prompt/confirm) ----------
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalInputWrap = document.getElementById("modalInputWrap");
const modalInputLabel = document.getElementById("modalInputLabel");
const modalInput = document.getElementById("modalInput");
const modalCancelBtn = document.getElementById("modalCancelBtn");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");

let modalResolve = null;

function openModal({ title, message = null, inputLabel = null, inputValue = "", confirmText = "Confirm", danger = false }) {
  modalTitle.textContent = title;

  if (message) {
    modalMessage.textContent = message;
    modalMessage.style.display = "block";
  } else {
    modalMessage.style.display = "none";
  }

  if (inputLabel) {
    modalInputWrap.style.display = "flex";
    modalInputLabel.textContent = inputLabel;
    modalInput.value = inputValue;
  } else {
    modalInputWrap.style.display = "none";
  }

  modalConfirmBtn.textContent = confirmText;
  modalConfirmBtn.classList.toggle("danger-btn", danger);
  modalOverlay.style.display = "flex";
  if (inputLabel) setTimeout(() => modalInput.focus(), 30);

  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  modalOverlay.style.display = "none";
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

modalCancelBtn.addEventListener("click", () => closeModal(null));
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal(null);
});
modalConfirmBtn.addEventListener("click", () => {
  const hasInput = modalInputWrap.style.display !== "none";
  closeModal(hasInput ? modalInput.value.trim() : true);
});
modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    modalConfirmBtn.click();
  }
});

// ---------- DOM refs ----------
const searchForm = document.getElementById("searchForm");
const huntBtn = document.getElementById("huntBtn");
const searchStatus = document.getElementById("searchStatus");
const recordsBody = document.getElementById("recordsBody");
const emptyState = document.getElementById("emptyState");
const quotaRemainingEl = document.getElementById("quotaRemaining");
const quotaRingFill = document.getElementById("quotaRingFill");

const filterSearch = document.getElementById("filterSearch");
const clearScopeBtn = document.getElementById("clearScopeBtn");
const scopeLine = document.getElementById("scopeLine");

const statusDropdown = document.getElementById("statusDropdown");
const statusDropdownTrigger = document.getElementById("statusDropdownTrigger");
const statusDropdownPanel = document.getElementById("statusDropdownPanel");
const statusDropdownLabel = document.getElementById("statusDropdownLabel");

const needDropdown = document.getElementById("needDropdown");
const needDropdownTrigger = document.getElementById("needDropdownTrigger");
const needDropdownPanel = document.getElementById("needDropdownPanel");
const needDropdownLabel = document.getElementById("needDropdownLabel");

const sortDropdown = document.getElementById("sortDropdown");
const sortDropdownTrigger = document.getElementById("sortDropdownTrigger");
const sortDropdownPanel = document.getElementById("sortDropdownPanel");
const sortDropdownLabel = document.getElementById("sortDropdownLabel");

const quickNicheDropdown = document.getElementById("quickNicheDropdown");
const quickNicheDropdownTrigger = document.getElementById("quickNicheDropdownTrigger");
const quickNicheDropdownPanel = document.getElementById("quickNicheDropdownPanel");
const quickNicheDropdownLabel = document.getElementById("quickNicheDropdownLabel");

const quickCityDropdown = document.getElementById("quickCityDropdown");
const quickCityDropdownTrigger = document.getElementById("quickCityDropdownTrigger");
const quickCityDropdownPanel = document.getElementById("quickCityDropdownPanel");
const quickCityDropdownLabel = document.getElementById("quickCityDropdownLabel");

const boardFilters = document.getElementById("boardFilters");

const scrapeBtn = document.getElementById("scrapeBtn");
const scrapePanel = document.getElementById("scrapePanel");
const scrapeStopBtn = document.getElementById("scrapeStopBtn");
const scrapeRefreshBtn = document.getElementById("scrapeRefreshBtn");
const scrapeStatusLine = document.getElementById("scrapeStatusLine");
const outreachTree = document.getElementById("outreachTree");

const paginationRow = document.getElementById("paginationRow");
const pageInfo = document.getElementById("pageInfo");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");

const filterState = { status: "", need: "" };
const SORT_OPTIONS = [
  { value: "created_at", label: "Latest first", color: "#948d80" },
  { value: "name", label: "Name (A-Z)", color: "#7fa8d9" },
  { value: "rating", label: "Rating (high-low)", color: "#7fb88a" },
];

const catchLogNameInput = document.getElementById("catchLogName");

const nichesTree = document.getElementById("nichesTree");
const newNicheBtnTree = document.getElementById("newNicheBtnTree");

const huntFormPanel = document.getElementById("huntFormPanel");
const boardPanel = document.getElementById("boardPanel");
const reportsPanel = document.getElementById("reportsPanel");
const newHuntLeafBtn = document.getElementById("newHuntLeafBtn");

// Themed niche dropdown
const nicheDropdown = document.getElementById("nicheDropdown");
const nicheDropdownTrigger = document.getElementById("nicheDropdownTrigger");
const nicheDropdownPanel = document.getElementById("nicheDropdownPanel");
const nicheDropdownList = document.getElementById("nicheDropdownList");
const nicheDropdownLabel = document.getElementById("nicheDropdownLabel");
const nicheDropdownNewBtn = document.getElementById("nicheDropdownNewBtn");

const RING_CIRCUMFERENCE = 106.8;

const TAG_CLASS_MAP = {
  "Website Design": "website",
  "GMB Optimization": "gmb",
  "Local SEO": "seo",
  "Review Generation": "review",
  "Reputation Management": "rep",
};

const STATUS_COLORS = [
  { value: "", label: "All statuses", color: "#948d80" },
  { value: "new", label: "New", color: "#7fa8d9" },
  { value: "shortlisted", label: "Shortlisted", color: "#e0b355" },
  { value: "contacted", label: "Contacted", color: "#ff6a3d" },
  { value: "engaged", label: "Engaged", color: "#c586e0" },
  { value: "converted", label: "Converted", color: "#4fd1c5" },
  { value: "won", label: "Won", color: "#7fb88a" },
  { value: "rejected", label: "Rejected", color: "#d95d5d" },
];

const NEED_COLORS = [
  { value: "", label: "All needs", color: "#948d80" },
  { value: "Website Design", label: "Website Design", color: "#d95d5d" },
  { value: "GMB Optimization", label: "GMB Optimization", color: "#e0b355" },
  { value: "Local SEO", label: "Local SEO", color: "#7fa8d9" },
  { value: "Review Generation", label: "Review Generation", color: "#7fb88a" },
  { value: "Reputation Management", label: "Reputation Management", color: "#ff6a3d" },
];

const state = {
  niches: [],
  catchLogs: [],
  activeCatchLogId: null,
  activeNicheId: null, // quick-filter: show all cities within this niche (board mode only)
  openNicheIds: new Set(),
  selectedNicheId: null, // for the Hunt form's niche dropdown

  contentView: "huntForm", // "huntForm" | "board" | "reports" - which content panel is shown
  mode: "board", // "board" | "outreach"
  page: 1,
  pageSize: 50,
  sortBy: "created_at",
  sortDir: null, // null = use the column's sensible default direction

  outreach: {
    nicheId: null,
    catchLogId: null,
    status: "shortlisted",
  },
  outreachOpenNicheIds: new Set(),
  outreachOpenCityIds: new Set(), // "nicheId:catchLogId" -> expanded to show status leaves
  outreachSummaries: new Map(), // nicheId -> [{catchLogId, catchLogName, shortlisted, contacted, won}]
};

function setContentView(view) {
  state.contentView = view;
  const ALL_VIEWS = {
    huntForm: huntFormPanel,
    board: boardPanel,
    reports: reportsPanel,
    "settings-api": document.getElementById("settingsApiView"),
    "settings-colors": document.getElementById("settingsColorsView"),
    "settings-team": document.getElementById("settingsTeamView"),
  };
  Object.entries(ALL_VIEWS).forEach(([name, el]) => {
    if (!el) return;
    // Toggle a class instead of setting inline style.display - an inline
    // style always overrides the stylesheet regardless of specificity, so
    // forcing display:block here was silently breaking board-panel's own
    // "display: flex" CSS (needed for its records-wrap to correctly
    // compute a bounded, scrollable height instead of growing to fit all
    // content unboundedly).
    el.classList.toggle("view-hidden", name !== view);
  });

  document.querySelectorAll(".nav-section-header").forEach((btn) => {
    btn.classList.toggle("active-view", btn.dataset.section === view || (view === "board" && btn.dataset.section === state.lastNavSection));
  });
  document.querySelectorAll(".nav-leaf[data-goto]").forEach((leaf) => {
    leaf.classList.toggle("active", leaf.dataset.goto === view);
  });

  if (view === "reports") {
    loadReportsFilterOptions();
    loadReports();
  }
}

function tagClass(tag) {
  return TAG_CLASS_MAP[tag] || "low";
}

// ---------- Left panel collapse (sticky when open, per request) ----------
const leftCol = document.getElementById("leftCol");
const layoutEl = document.querySelector("main.layout");
const collapseToggleBtn = document.getElementById("collapseToggleBtn");

collapseToggleBtn.addEventListener("click", () => {
  const collapsed = leftCol.classList.toggle("collapsed");
  layoutEl.classList.toggle("panel-collapsed", collapsed);
  collapseToggleBtn.title = collapsed ? "Expand panel" : "Collapse panel";
});

// ---------- Filters bar collapse toggle ----------
document.getElementById("filtersToggleBtn").addEventListener("click", () => {
  boardFilters.classList.toggle("collapsed");
});

// ---------- Export current view (CSV/XLSX/PDF, same filters as the board) ----------
const exportViewMenu = document.getElementById("exportViewMenu");
exportViewMenu.querySelector('[data-action="toggle-export"]').addEventListener("click", (e) => {
  e.stopPropagation();
  const wasOpen = exportViewMenu.classList.contains("open");
  document.querySelectorAll("[data-export-menu].open, #exportViewMenu.open").forEach((m) => m.classList.remove("open"));
  if (!wasOpen) exportViewMenu.classList.add("open");
});
document.addEventListener("click", (e) => {
  if (!exportViewMenu.contains(e.target)) exportViewMenu.classList.remove("open");
});
exportViewMenu.querySelectorAll("[data-export-view]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const format = link.dataset.exportView;
    const params = new URLSearchParams();
    params.set("sortBy", state.sortBy);
    if (state.sortDir) params.set("sortDir", state.sortDir);

    if (state.mode === "outreach") {
      if (state.outreach.catchLogId) {
        params.set("catchLogId", state.outreach.catchLogId);
        params.set("status", state.outreach.status);
      }
    } else {
      if (filterSearch.value) params.set("search", filterSearch.value);
      if (filterState.status) params.set("status", filterState.status);
      if (filterState.need) params.set("need", filterState.need);
      if (state.activeCatchLogId) params.set("catchLogId", state.activeCatchLogId);
      else if (state.activeNicheId) params.set("nicheId", state.activeNicheId);
    }

    window.location.href = `/api/leads/export/${format}?${params.toString()}`;
    exportViewMenu.classList.remove("open");
  });
});

// ---------- Contact deep-scrape (separate Python microservice) ----------
let scrapePollTimer = null;

function updateScrapeProgress(status) {
  const c = status.counts || {};
  const total = c.total || 0;
  const done = c.done || 0;
  const scraping = c.scraping || 0;
  const failed = c.failed || 0;
  const pending = c.pending || 0;

  document.getElementById("scrapeTotal").textContent = total;
  document.getElementById("scrapeRequests").textContent = status.requests_made || 0;
  document.getElementById("scrapeDone").textContent = done;
  document.getElementById("scrapeScraping").textContent = scraping;
  document.getElementById("scrapeFailed").textContent = failed;
  document.getElementById("scrapePending").textContent = pending;

  const segDone = document.getElementById("scrapeSegDone");
  const segScraping = document.getElementById("scrapeSegScraping");
  const segFailed = document.getElementById("scrapeSegFailed");
  const segPending = document.getElementById("scrapeSegPending");

  if (total === 0) {
    segDone.style.width = "0%";
    segScraping.style.width = "0%";
    segFailed.style.width = "0%";
    segPending.style.width = "100%";
  } else {
    segDone.style.width = (done / total) * 100 + "%";
    segScraping.style.width = (scraping / total) * 100 + "%";
    segFailed.style.width = (failed / total) * 100 + "%";
    segPending.style.width = (pending / total) * 100 + "%";
  }

  scrapeStopBtn.style.display = status.jobRunning ? "inline-block" : "none";

  if (status.jobRunning) {
    scrapeStatusLine.textContent = status.stop_requested
      ? "Stopping — finishing requests already in flight…"
      : "Scraping — checking each business's website for contact info…";
  } else if (status.merged) {
    scrapeStatusLine.textContent = `Done. ${status.mergedCount} record(s) updated with whatever contact info was found.`;
  } else {
    scrapeStatusLine.textContent = "";
  }
}

async function pollScrapeStatus() {
  const catchLogId = scrapeBtn.dataset.catchLogId;
  if (!catchLogId) return;

  try {
    const res = await api(`/api/catch-logs/${catchLogId}/scrape/status`);
    const status = await res.json();

    if (!status.active) {
      clearInterval(scrapePollTimer);
      scrapePollTimer = null;
      if (status.merged) {
        updateScrapeProgress(status);
        await loadLeads(); // refresh so new social icons show up
      }
      return;
    }

    updateScrapeProgress(status);
  } catch (err) {
    console.error("Failed to poll scrape status:", err);
    clearInterval(scrapePollTimer);
    scrapePollTimer = null;
    scrapeStatusLine.textContent = "Lost connection to the scraper service.";
  }
}

const scrapeStartBtn = document.getElementById("scrapeStartBtn");

// Clicking the icon only shows/hides the panel and checks the CURRENT
// status (read-only) - it never starts a scrape on its own. This also
// means switching between catch logs and reopening the panel always shows
// that specific catch log's real state instead of stale numbers left over
// from whatever was viewed before.
scrapeBtn.addEventListener("click", async () => {
  const isOpen = scrapePanel.style.display !== "none";
  if (isOpen) {
    scrapePanel.style.display = "none";
    if (scrapePollTimer) {
      clearInterval(scrapePollTimer);
      scrapePollTimer = null;
    }
    return;
  }

  scrapePanel.style.display = "block";
  scrapeStatusLine.textContent = "Checking current status…";
  await pollScrapeStatus();
  // If a job is already running for this catch log (e.g. the panel was
  // closed and reopened, or another tab started it), resume live polling.
  if (scrapePollTimer === null) {
    const catchLogId = scrapeBtn.dataset.catchLogId;
    if (catchLogId) {
      try {
        const res = await api(`/api/catch-logs/${catchLogId}/scrape/status`);
        const status = await res.json();
        if (status.active && status.jobRunning) {
          scrapePollTimer = setInterval(pollScrapeStatus, 2500);
        }
      } catch (err) {
        console.error("Failed to check scrape status on open:", err);
      }
    }
  }
});

scrapeStartBtn.addEventListener("click", async () => {
  const catchLogId = scrapeBtn.dataset.catchLogId;
  if (!catchLogId) return;

  scrapeStatusLine.textContent = "Starting…";
  scrapeStartBtn.disabled = true;

  try {
    const res = await api(`/api/catch-logs/${catchLogId}/scrape/start`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start scrape");

    scrapeStatusLine.textContent = `Scraping ${data.queued} business(es)…`;
    if (scrapePollTimer) clearInterval(scrapePollTimer);
    scrapePollTimer = setInterval(pollScrapeStatus, 2500);
    await pollScrapeStatus();
  } catch (err) {
    scrapeStatusLine.textContent = err.message;
  } finally {
    scrapeStartBtn.disabled = false;
  }
});

scrapeStopBtn.addEventListener("click", async () => {
  const catchLogId = scrapeBtn.dataset.catchLogId;
  if (!catchLogId) return;
  scrapeStopBtn.disabled = true;
  try {
    await api(`/api/catch-logs/${catchLogId}/scrape/stop`, { method: "POST" });
  } catch (err) {
    console.error("Failed to stop scrape:", err);
  } finally {
    scrapeStopBtn.disabled = false;
  }
});

scrapeRefreshBtn.addEventListener("click", pollScrapeStatus);

// ---------- Sidebar nav sections (Hunt / Reach Out collapsible; Reports single page) ----------
document.querySelectorAll(".nav-section-header").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const section = btn.dataset.section;

    // If the sidebar itself is collapsed to icon-only, clicking any section
    // icon expands it back out first - a collapsed sidebar can't usefully
    // show a nested Niche/City tree, so there's no reason to click an icon
    // there except to want the full panel back.
    if (leftCol.classList.contains("collapsed")) {
      leftCol.classList.remove("collapsed");
      layoutEl.classList.remove("panel-collapsed");
      collapseToggleBtn.title = "Collapse panel";
    }

    if (section === "reports") {
      state.lastNavSection = "reports";
      setContentView("reports");
      return;
    }

    // Hunt / Reach Out headers toggle their section open/closed (sidebar
    // accordion), independent of which content view is currently showing.
    const navSection = btn.closest(".nav-section");
    const willOpen = !navSection.classList.contains("open");

    // Accordion behavior: only one section (Hunt / Reach Out / Settings)
    // stays open at a time - opening one closes the others automatically.
    document.querySelectorAll(".nav-section.open").forEach((s) => {
      if (s !== navSection) s.classList.remove("open");
    });
    navSection.classList.toggle("open", willOpen);

    if (section === "reachout" && navSection.classList.contains("open")) {
      await renderOutreachTree();
    }
  });
});

newHuntLeafBtn.addEventListener("click", () => {
  state.lastNavSection = "hunt";
  setContentView("huntForm");
});

function setBoardMode(mode) {
  state.mode = mode;
  state.page = 1;
  if (mode === "outreach") {
    boardFilters.style.display = "none"; // irrelevant in outreach mode - scope is already fixed by the tree click
    boardPanel.style.borderTop = `3px solid ${statusColorFor(state.outreach.status)}`;
  } else {
    boardFilters.style.removeProperty("display"); // let the .collapsed class (toggled by the funnel button) govern visibility
    boardPanel.style.borderTop = "";
  }
  updateScopeLine();
  loadLeads();
}

// ---------- Quota ----------
async function refreshQuota() {
  const res = await api("/api/search/quota");
  const data = await res.json();
  quotaRemainingEl.textContent = data.remaining;
  const fraction = data.cap > 0 ? data.remaining / data.cap : 0;
  quotaRingFill.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
}

// ---------- Niche dropdown (Hunt form) ----------
nicheDropdownTrigger.addEventListener("click", () => {
  const wasOpen = nicheDropdown.classList.contains("open");
  [nicheDropdown, statusDropdown, needDropdown, sortDropdown, quickNicheDropdown, quickCityDropdown].forEach((d) => d.classList.remove("open"));
  if (!wasOpen) nicheDropdown.classList.add("open");
});

function renderNicheDropdown() {
  if (state.niches.length === 0) {
    nicheDropdownList.innerHTML = `<div class="theme-dropdown-item" style="color:var(--text-muted);cursor:default;">No niches yet</div>`;
  } else {
    nicheDropdownList.innerHTML = state.niches
      .map(
        (n) => `<div class="theme-dropdown-item ${n.id === state.selectedNicheId ? "selected" : ""}" data-niche-id="${n.id}">${n.name}</div>`
      )
      .join("");
  }

  if (state.selectedNicheId) {
    const niche = state.niches.find((n) => n.id === state.selectedNicheId);
    nicheDropdownLabel.textContent = niche ? niche.name : "Select a niche…";
  } else {
    nicheDropdownLabel.textContent = "Select a niche…";
  }
}

nicheDropdownList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-niche-id]");
  if (!item) return;
  state.selectedNicheId = Number(item.dataset.nicheId);
  renderNicheDropdown();
  nicheDropdown.classList.remove("open");
});

nicheDropdownNewBtn.addEventListener("click", async () => {
  nicheDropdown.classList.remove("open");
  const name = await openModal({ title: "New niche", inputLabel: "Niche name", confirmText: "Create" });
  if (name) {
    const res = await api("/api/niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Could not create niche");
      return;
    }
    await loadNichesAndLogs();
    state.selectedNicheId = data.id;
    renderNicheDropdown();
  }
});

// ---------- Filter dropdowns (custom-built, not native <select>, so option
// colors render consistently in every browser - Chrome/Safari/macOS in
// particular often ignore CSS on native <option> elements entirely) ----------
function buildFilterDropdown({ options, trigger, panel, label, currentValue, onSelect }) {
  panel.innerHTML = options
    .map(
      (opt) => `
      <div class="theme-dropdown-item filter-item ${opt.value === currentValue ? "selected" : ""}" data-value="${opt.value}">
        <span class="filter-dot" style="background:${opt.color}"></span>${opt.label}
      </div>`
    )
    .join("");

  const selected = options.find((o) => o.value === currentValue);
  label.textContent = selected ? selected.label : options[0].label;

  panel.querySelectorAll("[data-value]").forEach((el) => {
    el.addEventListener("click", () => {
      onSelect(el.dataset.value);
      trigger.closest(".theme-dropdown").classList.remove("open");
    });
  });
}

function renderStatusDropdown() {
  buildFilterDropdown({
    options: STATUS_COLORS,
    trigger: statusDropdownTrigger,
    panel: statusDropdownPanel,
    label: statusDropdownLabel,
    currentValue: filterState.status,
    onSelect: (value) => {
      filterState.status = value;
      renderStatusDropdown();
      loadLeads();
    },
  });
}

function renderNeedDropdown() {
  buildFilterDropdown({
    options: NEED_COLORS,
    trigger: needDropdownTrigger,
    panel: needDropdownPanel,
    label: needDropdownLabel,
    currentValue: filterState.need,
    onSelect: (value) => {
      filterState.need = value;
      renderNeedDropdown();
      state.page = 1;
      loadLeads();
    },
  });
}

function renderSortDropdown() {
  buildFilterDropdown({
    options: SORT_OPTIONS,
    trigger: sortDropdownTrigger,
    panel: sortDropdownPanel,
    label: sortDropdownLabel,
    currentValue: state.sortBy,
    onSelect: (value) => {
      state.sortBy = value;
      state.page = 1;
      renderSortDropdown();
      loadLeads();
    },
  });
}

function renderQuickNicheDropdown() {
  const options = [
    { value: "", label: "All niches", color: "#948d80" },
    ...state.niches.map((n) => ({ value: String(n.id), label: n.name, color: "#7fa8d9" })),
  ];
  buildFilterDropdown({
    options,
    trigger: quickNicheDropdownTrigger,
    panel: quickNicheDropdownPanel,
    label: quickNicheDropdownLabel,
    currentValue: state.activeNicheId ? String(state.activeNicheId) : "",
    onSelect: (value) => {
      state.activeNicheId = value ? Number(value) : null;
      state.activeCatchLogId = null; // switching niche clears any specific-city scope
      state.page = 1;
      renderQuickNicheDropdown();
      renderQuickCityDropdown();
      updateScopeLine();
      loadLeads();
    },
  });
}

function renderQuickCityDropdown() {
  const cities = state.activeNicheId
    ? state.catchLogs.filter((l) => l.niche_id === state.activeNicheId)
    : [];
  const options = [
    { value: "", label: state.activeNicheId ? "All cities in niche" : "All cities", color: "#948d80" },
    ...cities.map((c) => ({ value: String(c.id), label: c.name, color: "#7fb88a" })),
  ];
  buildFilterDropdown({
    options,
    trigger: quickCityDropdownTrigger,
    panel: quickCityDropdownPanel,
    label: quickCityDropdownLabel,
    currentValue: state.activeCatchLogId ? String(state.activeCatchLogId) : "",
    onSelect: (value) => {
      state.activeCatchLogId = value ? Number(value) : null;
      state.page = 1;
      renderQuickCityDropdown();
      updateScopeLine();
      loadLeads();
    },
  });
}

const ALL_TOP_DROPDOWNS = [nicheDropdown, statusDropdown, needDropdown, sortDropdown, quickNicheDropdown, quickCityDropdown];

[statusDropdown, needDropdown, sortDropdown, quickNicheDropdown, quickCityDropdown].forEach((dd) => {
  const trigger = dd.querySelector(".theme-dropdown-trigger");
  trigger.addEventListener("click", () => {
    const wasOpen = dd.classList.contains("open");
    ALL_TOP_DROPDOWNS.forEach((d) => d.classList.remove("open"));
    if (!wasOpen) dd.classList.add("open");
  });
});
document.addEventListener("click", (e) => {
  ALL_TOP_DROPDOWNS.forEach((d) => {
    if (!d.contains(e.target)) d.classList.remove("open");
  });
});

// ---------- Niches + catch logs ----------
async function loadNichesAndLogs() {
  const [nichesRes, logsRes] = await Promise.all([api("/api/niches"), api("/api/catch-logs")]);
  state.niches = await nichesRes.json();
  state.catchLogs = await logsRes.json();

  if (!state.selectedNicheId && state.niches.length > 0) {
    state.selectedNicheId = state.niches[0].id;
  }

  renderNicheDropdown();
  renderNichesTree();
  renderQuickNicheDropdown();
  renderQuickCityDropdown();
}

const EXPORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/></svg>`;

function exportMenuHtml(kind, id) {
  // kind: "niche" -> csv/xlsx/pdf ; "log" -> csv/pdf
  const base = kind === "niche" ? `/api/niches/${id}/export` : `/api/catch-logs/${id}/export`;
  const links =
    kind === "niche"
      ? `<a href="${base}/csv">CSV</a><a href="${base}/xlsx">XLSX</a><a href="${base}/pdf">PDF</a>`
      : `<a href="${base}/csv">CSV</a><a href="${base}/pdf">PDF</a>`;
  return `
    <div class="export-menu" data-export-menu>
      <button class="icon-btn" data-action="toggle-export" title="Export">${EXPORT_SVG}</button>
      <div class="export-list">${links}</div>
    </div>`;
}

function renderNichesTree() {
  if (state.niches.length === 0) {
    nichesTree.innerHTML = `<div class="empty-state">No niches yet. Create one with "+ New" or by running a search.</div>`;
    return;
  }

  nichesTree.innerHTML = state.niches
    .map((niche) => {
      const logs = state.catchLogs.filter((l) => l.niche_id === niche.id);
      const isOpen = state.openNicheIds.has(niche.id);
      const logsHtml = logs
        .map(
          (log) => `
        <div class="catchlog-row ${log.id === state.activeCatchLogId ? "active" : ""}" data-log-id="${log.id}">
          <div>
            <div class="catchlog-name">${log.name}</div>
            <div class="catchlog-meta">${log.lead_count} record${log.lead_count === 1 ? "" : "s"}</div>
          </div>
          <div class="niche-actions">
            ${exportMenuHtml("log", log.id)}
            <button class="icon-btn" data-action="rename-log" data-id="${log.id}" title="Rename"><i class="bi bi-pencil"></i></button>
            <button class="icon-btn" data-action="delete-log" data-id="${log.id}" title="Delete"><i class="bi bi-trash"></i></button>
          </div>
        </div>`
        )
        .join("");

      return `
      <div class="niche-block ${isOpen ? "open" : ""}" data-niche-id="${niche.id}">
        <div class="niche-row" data-action="toggle-niche" data-id="${niche.id}">
          <div class="niche-row-main">
            <span class="niche-caret">▶</span>
            <span class="niche-name">${niche.name}</span>
            <span class="niche-count">${logs.length} log${logs.length === 1 ? "" : "s"} · ${niche.lead_count} leads</span>
          </div>
          <div class="niche-actions">
            ${exportMenuHtml("niche", niche.id)}
            <button class="icon-btn" data-action="rename-niche" data-id="${niche.id}" title="Rename"><i class="bi bi-pencil"></i></button>
            <button class="icon-btn" data-action="delete-niche" data-id="${niche.id}" title="Delete"><i class="bi bi-trash"></i></button>
          </div>
        </div>
        <div class="catchlog-list">${logsHtml || '<div class="catchlog-row"><span class="catchlog-meta">No catch logs yet</span></div>'}</div>
      </div>`;
    })
    .join("");
}

// toggle export dropdowns, closing others when one opens
nichesTree.addEventListener("click", (e) => {
  const toggle = e.target.closest('[data-action="toggle-export"]');
  if (toggle) {
    const menu = toggle.closest("[data-export-menu]");
    const wasOpen = menu.classList.contains("open");
    document.querySelectorAll("[data-export-menu].open").forEach((m) => m.classList.remove("open"));
    if (!wasOpen) menu.classList.add("open");
    e.stopPropagation();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-export-menu]")) {
    document.querySelectorAll("[data-export-menu].open").forEach((m) => m.classList.remove("open"));
  }
});

nichesTree.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target || target.dataset.action === "toggle-export") return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  if (action === "toggle-niche") {
    const nicheId = Number(id);
    if (state.openNicheIds.has(nicheId)) state.openNicheIds.delete(nicheId);
    else state.openNicheIds.add(nicheId);
    renderNichesTree();
    return;
  }

  if (action === "rename-niche") {
    const niche = state.niches.find((n) => n.id === Number(id));
    const newName = await openModal({ title: "Rename niche", inputLabel: "Niche name", inputValue: niche.name, confirmText: "Save" });
    if (newName) {
      const res = await api(`/api/niches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Rename failed");
      }
      await loadNichesAndLogs();
    }
    return;
  }

  if (action === "delete-niche") {
    const niche = state.niches.find((n) => n.id === Number(id));
    const confirmed = await openModal({
      title: `Delete "${niche.name}"?`,
      message: "This also deletes ALL its catch logs and every record inside them. This cannot be undone.",
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      await api(`/api/niches/${id}`, { method: "DELETE" });
      if (state.activeCatchLogId && state.catchLogs.some((l) => l.id === state.activeCatchLogId && l.niche_id === Number(id))) {
        state.activeCatchLogId = null;
        updateScopeLine();
      }
      if (state.selectedNicheId === Number(id)) state.selectedNicheId = null;
      await loadNichesAndLogs();
      await loadLeads();
    }
    return;
  }

  if (action === "rename-log") {
    const log = state.catchLogs.find((l) => l.id === Number(id));
    const newName = await openModal({ title: "Rename catch log", inputLabel: "Catch log name", inputValue: log.name, confirmText: "Save" });
    if (newName) {
      await api(`/api/catch-logs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      await loadNichesAndLogs();
      if (state.activeCatchLogId === Number(id)) updateScopeLine();
    }
    return;
  }

  if (action === "delete-log") {
    const log = state.catchLogs.find((l) => l.id === Number(id));
    const confirmed = await openModal({
      title: `Delete "${log.name}"?`,
      message: `This deletes all ${log.lead_count} record(s) in this catch log. This cannot be undone.`,
      confirmText: "Delete",
      danger: true,
    });
    if (confirmed) {
      await api(`/api/catch-logs/${id}`, { method: "DELETE" });
      if (state.activeCatchLogId === Number(id)) {
        state.activeCatchLogId = null;
        updateScopeLine();
      }
      await loadNichesAndLogs();
      await loadLeads();
    }
    return;
  }
});

// clicking a catch log row itself (not its buttons) sets it as the active scope
nichesTree.addEventListener("click", async (e) => {
  const row = e.target.closest(".catchlog-row");
  if (!row || e.target.closest("[data-action]") || e.target.closest("[data-export-menu]")) return;
  const logId = Number(row.dataset.logId);
  if (!logId) return;
  state.activeCatchLogId = logId;
  state.activeNicheId = null;
  state.page = 1;
  state.lastNavSection = "hunt";
  setContentView("board");
  renderNichesTree();
  renderQuickNicheDropdown();
  renderQuickCityDropdown();
  setBoardMode("board");
});

// ---------- Outreach Report tree ----------
async function getOutreachSummary(nicheId) {
  if (state.outreachSummaries.has(nicheId)) return state.outreachSummaries.get(nicheId);
  const res = await api(`/api/niches/${nicheId}/outreach-summary`);
  const summary = await res.json();
  state.outreachSummaries.set(nicheId, summary);
  return summary;
}

const OUTREACH_STATUS_LIST = [
  { key: "shortlisted", label: "Shortlisted" },
  { key: "contacted", label: "Contacted" },
  { key: "engaged", label: "Engaged" },
  { key: "converted", label: "Converted" },
  { key: "won", label: "Won" },
];

// Instantly nudges a status-leaf's badge count in the currently-rendered
// Reach Out tree (if that city happens to be expanded/visible right now) -
// avoids waiting on a full tree re-fetch just to reflect a count that
// changed by exactly one.
function adjustOutreachBadgeCount(nicheId, catchLogId, status, delta) {
  const leaf = outreachTree.querySelector(
    `.status-leaf-row[data-niche-id="${nicheId}"][data-log-id="${catchLogId}"][data-status="${status}"]`
  );
  if (!leaf) return;
  const badge = leaf.querySelector(".outreach-badge");
  if (!badge) return;
  const current = parseInt(badge.textContent, 10) || 0;
  badge.textContent = Math.max(current + delta, 0);
}

async function renderOutreachTree() {
  if (state.niches.length === 0) {
    outreachTree.innerHTML = `<div class="empty-state">No niches yet. Create one under Hunt first.</div>`;
    return;
  }

  const blocks = await Promise.all(
    state.niches.map(async (niche) => {
      const isOpen = state.outreachOpenNicheIds.has(niche.id);
      let citiesHtml = "";
      if (isOpen) {
        const summary = await getOutreachSummary(niche.id);
        citiesHtml = summary.length
          ? summary
              .map((city) => {
                const cityKey = `${niche.id}:${city.catchLogId}`;
                const cityOpen = state.outreachOpenCityIds.has(cityKey);
                const cityTotal =
                  city.shortlisted + city.contacted + city.engaged + city.converted + city.won;

                const statusLeaves = OUTREACH_STATUS_LIST.map(
                  (s) => `
                  <div class="status-leaf-row ${
                    state.outreach.catchLogId === city.catchLogId && state.outreach.status === s.key && state.mode === "outreach"
                      ? "active"
                      : ""
                  }" data-niche-id="${niche.id}" data-log-id="${city.catchLogId}" data-status="${s.key}">
                    <span class="outreach-badge ${s.key}">${city[s.key]}</span>
                    <span class="status-leaf-label">${s.label}</span>
                  </div>`
                ).join("");

                return `
                <div class="catchlog-block ${cityOpen ? "open" : ""}">
                  <div class="catchlog-row outreach-city-row" data-action="toggle-outreach-city" data-niche-id="${niche.id}" data-log-id="${city.catchLogId}">
                    <span class="niche-caret small">▶</span>
                    <div class="catchlog-name">${city.catchLogName}</div>
                    <div class="catchlog-meta">${cityTotal} total</div>
                  </div>
                  <div class="status-leaf-list">${statusLeaves}</div>
                </div>`;
              })
              .join("")
          : `<div class="catchlog-row"><span class="catchlog-meta">No catch logs yet</span></div>`;
      }

      return `
        <div class="niche-block ${isOpen ? "open" : ""}" data-niche-id="${niche.id}">
          <div class="niche-row" data-action="toggle-outreach-niche" data-id="${niche.id}">
            <div class="niche-row-main">
              <span class="niche-caret">▶</span>
              <span class="niche-name">${niche.name}</span>
              <span class="niche-count">${niche.catch_log_count} cit${niche.catch_log_count === 1 ? "y" : "ies"}</span>
            </div>
          </div>
          <div class="catchlog-list">${citiesHtml}</div>
        </div>`;
    })
  );

  outreachTree.innerHTML = blocks.join("");
}

outreachTree.addEventListener("click", async (e) => {
  const toggleNiche = e.target.closest('[data-action="toggle-outreach-niche"]');
  if (toggleNiche) {
    const nicheId = Number(toggleNiche.dataset.id);
    if (state.outreachOpenNicheIds.has(nicheId)) state.outreachOpenNicheIds.delete(nicheId);
    else state.outreachOpenNicheIds.add(nicheId);
    await renderOutreachTree();
    return;
  }

  const toggleCity = e.target.closest('[data-action="toggle-outreach-city"]');
  if (toggleCity) {
    const cityKey = `${toggleCity.dataset.nicheId}:${toggleCity.dataset.logId}`;
    if (state.outreachOpenCityIds.has(cityKey)) state.outreachOpenCityIds.delete(cityKey);
    else state.outreachOpenCityIds.add(cityKey);
    await renderOutreachTree();
    return;
  }

  const statusLeaf = e.target.closest(".status-leaf-row");
  if (statusLeaf) {
    state.outreach.nicheId = Number(statusLeaf.dataset.nicheId);
    state.outreach.catchLogId = Number(statusLeaf.dataset.logId);
    state.outreach.status = statusLeaf.dataset.status;
    state.page = 1;
    state.lastNavSection = "reachout";
    setContentView("board");
    await renderOutreachTree();
    setBoardMode("outreach");
  }
});

newNicheBtnTree.addEventListener("click", async () => {
  const name = await openModal({ title: "New niche", inputLabel: "Niche name", confirmText: "Create" });
  if (name) {
    const res = await api("/api/niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Could not create niche");
      return;
    }
    await loadNichesAndLogs();
  }
});

function currentScrapeCatchLogId() {
  if (state.mode === "outreach") return state.outreach.catchLogId || null;
  return state.activeCatchLogId || null;
}

function updateScrapeButtonVisibility() {
  const id = currentScrapeCatchLogId();
  const previousId = scrapeBtn.dataset.catchLogId;

  scrapeBtn.style.display = id ? "inline-flex" : "none";
  scrapeBtn.dataset.catchLogId = id || "";

  // Switched to a different catch log (or none) - close the panel and stop
  // polling so we never show one city's counts while looking at another.
  if (String(previousId || "") !== String(id || "")) {
    scrapePanel.style.display = "none";
    if (scrapePollTimer) {
      clearInterval(scrapePollTimer);
      scrapePollTimer = null;
    }
  }
}

function updateScopeLine() {
  updateScrapeButtonVisibility();

  if (state.mode === "outreach") {
    const log = state.outreach.catchLogId ? findOutreachCatchLog(state.outreach.catchLogId) : null;
    if (!log) {
      scopeLine.innerHTML = `<a class="breadcrumb-link" data-action="crumb-reachout-root">Reach Out</a> — pick a niche and city`;
    } else {
      const statusLabel =
        OUTREACH_STATUS_LIST.find((s) => s.key === state.outreach.status)?.label || state.outreach.status;
      scopeLine.innerHTML = `
        <a class="breadcrumb-link" data-action="crumb-reachout-root">Reach Out</a> /
        <a class="breadcrumb-link" data-action="crumb-reachout-niche" data-niche-id="${state.outreach.nicheId}">${log.nicheName}</a> /
        <a class="breadcrumb-link" data-action="crumb-reachout-city" data-niche-id="${state.outreach.nicheId}" data-log-id="${state.outreach.catchLogId}">${log.catchLogName}</a> /
        <strong>${statusLabel}</strong>`;
    }
    return;
  }

  if (state.activeCatchLogId) {
    const log = state.catchLogs.find((l) => l.id === state.activeCatchLogId);
    const niche = log ? state.niches.find((n) => n.id === log.niche_id) : null;
    scopeLine.innerHTML = `
      <a class="breadcrumb-link" data-action="crumb-hunt-root">Hunt</a> /
      <a class="breadcrumb-link" data-action="crumb-hunt-niche" data-niche-id="${niche ? niche.id : ""}">${niche ? niche.name : "?"}</a> /
      <strong>${log ? log.name : "?"}</strong>`;
    clearScopeBtn.style.display = "inline-block";
    return;
  }

  if (state.activeNicheId) {
    const niche = state.niches.find((n) => n.id === state.activeNicheId);
    scopeLine.innerHTML = `<a class="breadcrumb-link" data-action="crumb-hunt-root">Hunt</a> / <strong>${niche ? niche.name : "?"} (all cities)</strong>`;
    clearScopeBtn.style.display = "inline-block";
    return;
  }

  scopeLine.innerHTML = `<a class="breadcrumb-link" data-action="crumb-hunt-root">Hunt</a> / <strong>All records</strong>`;
  clearScopeBtn.style.display = "none";
}

scopeLine.addEventListener("click", async (e) => {
  const link = e.target.closest(".breadcrumb-link");
  if (!link) return;
  const action = link.dataset.action;

  if (action === "crumb-hunt-root") {
    state.activeCatchLogId = null;
    state.activeNicheId = null;
  } else if (action === "crumb-hunt-niche") {
    state.activeCatchLogId = null;
    state.activeNicheId = Number(link.dataset.nicheId) || null;
  } else if (action === "crumb-reachout-root") {
    state.outreach.catchLogId = null;
    state.outreach.nicheId = null;
  } else if (action === "crumb-reachout-niche") {
    state.outreach.catchLogId = null;
  } else if (action === "crumb-reachout-city") {
    state.outreach.status = "shortlisted";
  }
  state.page = 1;
  updateScopeLine();
  renderNichesTree();
  renderQuickNicheDropdown();
  renderQuickCityDropdown();
  await renderOutreachTree();
  await loadLeads();
});

function findOutreachCatchLog(catchLogId) {
  for (const [nicheId, summary] of state.outreachSummaries.entries()) {
    const match = summary.find((s) => s.catchLogId === catchLogId);
    if (match) {
      const niche = state.niches.find((n) => n.id === nicheId);
      return { nicheName: niche ? niche.name : "?", catchLogName: match.catchLogName };
    }
  }
  return null;
}

clearScopeBtn.addEventListener("click", async () => {
  state.activeCatchLogId = null;
  state.activeNicheId = null;
  state.page = 1;
  updateScopeLine();
  renderNichesTree();
  renderQuickNicheDropdown();
  renderQuickCityDropdown();
  await loadLeads();
});

// ---------- Leads board ----------
function mapsLinkFor(lead) {
  if (lead.place_id) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(lead.place_id)}`;
  if (lead.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`;
  return null;
}

// Click-to-chat link only - not a verified "is on WhatsApp" check (no free API
// can confirm that ahead of time). WhatsApp itself reports back if the number
// isn't reachable once the user actually opens the chat.
function whatsappLinkFor(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

const WHATSAPP_SVG = `<i class="bi bi-whatsapp"></i>`;

function statusColorFor(value) {
  const found = STATUS_COLORS.find((s) => s.value === value);
  return found ? found.color : "#948d80";
}

// Custom themed dropdown for the per-row status cell, same reasoning as the
// filter dropdowns above: native <option> colors don't render reliably
// across browsers, so build our own so the color always shows.
function rowStatusDropdownHtml(lead) {
  const color = statusColorFor(lead.status);
  const items = STATUS_COLORS.filter((s) => s.value !== "")
    .map(
      (s) => `
      <div class="theme-dropdown-item filter-item ${s.value === lead.status ? "selected" : ""}" data-value="${s.value}">
        <span class="filter-dot" style="background:${s.color}"></span>${s.label}
      </div>`
    )
    .join("");

  return `
    <div class="theme-dropdown row-status-dropdown" data-lead-id="${lead.id}">
      <button type="button" class="row-status-trigger" style="--status-color:${color};">
        <span class="filter-dot" style="background:${color}"></span>
        <span class="row-status-label">${lead.status}</span>
        <span class="theme-dropdown-caret">▾</span>
      </button>
      <div class="theme-dropdown-panel row-status-panel">${items}</div>
    </div>`;
}

// Single delegated listener for every row's status dropdown - attached once
// (not inside renderLeads) since recordsBody itself persists across re-renders.
recordsBody.addEventListener("click", (e) => {
  const trigger = e.target.closest(".row-status-trigger");
  if (trigger) {
    e.stopPropagation();
    const dd = trigger.closest(".row-status-dropdown");
    const wasOpen = dd.classList.contains("open");
    document.querySelectorAll(".row-status-dropdown.open").forEach((d) => d.classList.remove("open"));
    if (!wasOpen) dd.classList.add("open");
    return;
  }

  const item = e.target.closest(".row-status-panel [data-value]");
  if (item) {
    const dd = item.closest(".row-status-dropdown");
    const leadId = dd.dataset.leadId;
    const value = item.dataset.value;
    const color = statusColorFor(value);
    const oldValue = dd.querySelector(".row-status-label").textContent;

    // Update in place immediately - snappier than a full re-render, and the
    // rest of the row (needs/rating/etc.) doesn't depend on status anyway.
    dd.querySelector(".row-status-label").textContent = value;
    dd.querySelector(".row-status-trigger").style.setProperty("--status-color", color);
    dd.querySelectorAll("[data-value]").forEach((el) => el.classList.toggle("selected", el.dataset.value === value));
    dd.classList.remove("open");

    // In Reach Out mode, a status change away from the currently-viewed
    // pipeline stage should make the row vanish from this list right away,
    // not after a network round-trip - remove it instantly, let the
    // background refresh below correct S/N numbering.
    if (state.mode === "outreach" && value !== state.outreach.status) {
      const row = dd.closest(".list-row");
      if (row) row.remove();
      if (!recordsBody.querySelector(".list-row")) emptyState.style.display = "block";
    }

    // Badge counts in the sidebar tree also update instantly instead of
    // waiting on a full re-fetch - decrement the old status's badge,
    // increment the new one's, right in the currently-rendered DOM.
    if (state.mode === "outreach") {
      adjustOutreachBadgeCount(state.outreach.nicheId, state.outreach.catchLogId, oldValue, -1);
      adjustOutreachBadgeCount(state.outreach.nicheId, state.outreach.catchLogId, value, 1);
    }

    api(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    })
      .then(async () => {
        // Still refresh from the server shortly after, to correct S/N
        // numbering and catch any edge case the optimistic update missed -
        // this happens invisibly in the background, not blocking what the
        // user already sees.
        if (state.mode === "outreach") {
          state.outreachSummaries.clear();
          await renderOutreachTree();
          await loadLeads();
        }
      })
      .catch((err) => console.error("Failed to update lead status:", err));
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".row-status-dropdown")) {
    document.querySelectorAll(".row-status-dropdown.open").forEach((d) => d.classList.remove("open"));
  }
});

const LOCATION_PIN_SVG = `<i class="bi bi-geo-alt-fill"></i>`;

// Order matches the requested spec: Email, FB, Insta, Phone, LinkedIn, TikTok
const SOCIAL_ICON_META = {
  email: { icon: "bi-envelope-fill", bg: "#5a5550" },
  facebook: { icon: "bi-facebook", bg: "#3b5998" },
  instagram: { icon: "bi-instagram", bg: "#c8347a" },
  phone: { icon: "bi-telephone-fill", bg: "#4caf6d" },
  linkedin: { icon: "bi-linkedin", bg: "#0a66c2" },
  tiktok: { icon: "bi-tiktok", bg: "#111" },
};

function socialBadge(key) {
  const meta = SOCIAL_ICON_META[key];
  return `<span class="social-badge" style="background:${meta.bg}"><i class="bi ${meta.icon}"></i></span>`;
}

function socialLinksHtml(lead) {
  const socials = lead.socials || {};
  const items = [];

  if (socials.email) {
    items.push(`<a href="mailto:${socials.email}" class="social-icon" title="Email: ${socials.email}">${socialBadge("email")}</a>`);
  }
  if (socials.facebook) {
    items.push(`<a href="${socials.facebook}" target="_blank" rel="noopener" class="social-icon" title="Facebook">${socialBadge("facebook")}</a>`);
  }
  if (socials.instagram) {
    items.push(`<a href="${socials.instagram}" target="_blank" rel="noopener" class="social-icon" title="Instagram">${socialBadge("instagram")}</a>`);
  }
  // Uses the scraper's own tel: link finding, not the Google-Places phone
  // already shown in the Contact column - this icon specifically means "we
  // independently confirmed a click-to-call link on their own website."
  if (socials.phone) {
    items.push(`<a href="tel:${socials.phone.replace(/\s+/g, "")}" class="social-icon" title="Call ${socials.phone} (found on their website)">${socialBadge("phone")}</a>`);
  }
  if (socials.linkedin) {
    items.push(`<a href="${socials.linkedin}" target="_blank" rel="noopener" class="social-icon" title="LinkedIn">${socialBadge("linkedin")}</a>`);
  }
  if (socials.tiktok) {
    items.push(`<a href="${socials.tiktok}" target="_blank" rel="noopener" class="social-icon" title="TikTok">${socialBadge("tiktok")}</a>`);
  }

  return items.join("") || `<span class="no-website">—</span>`;
}

// Fixed set of need categories, always rendered as dots - "active" (colored)
// if this lead has that tag, dim/outline if not. Order matches tagClass().
const NEED_DOT_TYPES = [
  { label: "Website Design", cssClass: "website" },
  { label: "GMB Optimization", cssClass: "gmb" },
  { label: "Local SEO", cssClass: "seo" },
  { label: "Review Generation", cssClass: "review" },
  { label: "Reputation Management", cssClass: "rep" },
];

function needsDotsHtml(lead) {
  return `<div class="needs-dots">${NEED_DOT_TYPES.map(
    ({ label, cssClass }) =>
      `<span class="need-dot ${lead.needs.includes(label) ? "active " + cssClass : ""}" title="${label}${lead.needs.includes(label) ? "" : " (not applicable)"}"></span>`
  ).join("")}</div>`;
}

function renderLeads(leads) {
  recordsBody.innerHTML = "";

  if (leads.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  const startIndex = (state.page - 1) * state.pageSize;

  leads.forEach((lead, index) => {
    const row = document.createElement("div");
    row.className = "list-row";

    const mapLink = mapsLinkFor(lead);
    const locationHtml = mapLink
      ? `<a class="location-pin" href="${mapLink}" target="_blank" rel="noopener" title="${lead.address || "View on map"}">${LOCATION_PIN_SVG}</a>`
      : "";

    const waLink = whatsappLinkFor(lead.phone);
    const websiteHtml = lead.website
      ? `<a href="${lead.website}" target="_blank" rel="noopener">${(() => {
          try {
            return new URL(lead.website).hostname;
          } catch {
            return lead.website;
          }
        })()}</a>`
      : `<span class="no-website">no website</span>`;
    const phoneHtml = lead.phone
      ? `<span class="contact-line">${lead.phone}${
          waLink
            ? `<a class="whatsapp-icon" href="${waLink}" target="_blank" rel="noopener" title="Message on WhatsApp (unverified - opens chat, WhatsApp confirms on send)">${WHATSAPP_SVG}</a>`
            : ""
        }</span>`
      : `<span class="no-website">no phone listed</span>`;

    const ratingHtml = lead.rating
      ? `<span class="rating-val">${lead.rating.toFixed(1)} <small>(${lead.review_count ?? 0})</small></span>`
      : `<span class="rating-val" title="Rating Not Pulled — ratings cost extra API quota, so they're only fetched when 'Include ratings' is checked on a hunt"><small>RNP</small></span>`;

    row.innerHTML = `
      <div class="col-sn">${startIndex + index + 1}</div>
      <div>
        <div class="lead-name-row">
          ${locationHtml}
          <span class="lead-name" title="${lead.name}">${lead.name}</span>
        </div>
      </div>
      <div class="city-cell" title="${lead.city_name || ""}">${lead.city_name || "—"}</div>
      <div><div class="contact-row">${websiteHtml}<br/>${phoneHtml}</div></div>
      <div>${needsDotsHtml(lead)}</div>
      <div><div class="social-row">${socialLinksHtml(lead)}</div></div>
      <div>${ratingHtml}</div>
      <div>${rowStatusDropdownHtml(lead)}</div>
      <div class="row-actions"><button data-action="delete" data-id="${lead.id}" title="Remove"><i class="bi bi-trash"></i></button></div>
    `;
    recordsBody.appendChild(row);
  });

  recordsBody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("[data-id]").dataset.id;
      const confirmed = await openModal({
        title: "Remove this record?",
        message: "This deletes the lead permanently. This cannot be undone.",
        confirmText: "Remove",
        danger: true,
      });
      if (!confirmed) return;

      // Remove instantly instead of waiting on the network round-trip -
      // the delete call and the follow-up refreshes happen in the
      // background afterward, not blocking what the user sees.
      const row = e.target.closest(".list-row");
      if (row) row.remove();
      if (!recordsBody.querySelector(".list-row")) emptyState.style.display = "block";

      api(`/api/leads/${id}`, { method: "DELETE" })
        .then(() => {
          loadLeads(); // corrects S/N numbering and pagination counts shortly after
          loadNichesAndLogs();
        })
        .catch((err) => console.error("Failed to delete lead:", err));
    });
  });
}

function updatePaginationControls(total, totalPages) {
  if (total === 0) {
    paginationRow.style.display = "none";
    return;
  }
  paginationRow.style.display = "flex";
  pageInfo.textContent = `Page ${state.page} of ${totalPages} (${total} total)`;
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = state.page >= totalPages;
}

prevPageBtn.addEventListener("click", () => {
  if (state.page > 1) {
    state.page--;
    loadLeads();
  }
});
nextPageBtn.addEventListener("click", () => {
  state.page++;
  loadLeads();
});

async function loadLeads() {
  const params = new URLSearchParams();
  params.set("page", state.page);
  params.set("pageSize", state.pageSize);
  params.set("sortBy", state.sortBy);
  if (state.sortDir) params.set("sortDir", state.sortDir);

  if (state.mode === "outreach") {
    if (!state.outreach.catchLogId) {
      renderLeads([]);
      updatePaginationControls(0, 1);
      return;
    }
    params.set("catchLogId", state.outreach.catchLogId);
    params.set("status", state.outreach.status);
  } else {
    if (filterSearch.value) params.set("search", filterSearch.value);
    if (filterState.status) params.set("status", filterState.status);
    if (filterState.need) params.set("need", filterState.need);
    if (state.activeCatchLogId) {
      params.set("catchLogId", state.activeCatchLogId);
    } else if (state.activeNicheId) {
      params.set("nicheId", state.activeNicheId);
    }
  }

  const res = await api(`/api/leads?${params.toString()}`);
  const data = await res.json();
  renderLeads(data.leads);
  updatePaginationControls(data.total, data.totalPages);
}

// ---------- Search / hunt ----------
searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!state.selectedNicheId) {
    searchStatus.textContent = "Pick a niche first (or create a new one).";
    searchStatus.className = "search-status error";
    return;
  }

  huntBtn.disabled = true;
  searchStatus.textContent = "Hunting…";
  searchStatus.className = "search-status";

  const keyword = document.getElementById("keyword").value.trim();
  const location = document.getElementById("location").value.trim();
  const maxResults = Number(document.getElementById("maxResults").value) || 20;
  const includeRatings = document.getElementById("includeRatings").checked;
  const catchLogName = catchLogNameInput.value.trim();

  const payload = {
    keyword,
    location,
    maxResults,
    includeRatings,
    catchLogName,
    nicheId: state.selectedNicheId,
  };

  try {
    const res = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Search failed");

    searchStatus.textContent = `Pulled ${data.pulled} distinct leads into "${data.catchLogName}". ${data.remainingToday} left in today's quota.`;
    searchStatus.className = "search-status ok";

    state.activeCatchLogId = data.catchLogId;
    catchLogNameInput.value = "";

    await loadNichesAndLogs();
    state.openNicheIds.add(data.nicheId);
    renderNichesTree();
    updateScopeLine();
    await loadLeads();
    await refreshQuota();
  } catch (err) {
    searchStatus.textContent = err.message;
    searchStatus.className = "search-status error";
  } finally {
    huntBtn.disabled = false;
  }
});

// ---------- Filters ----------
let filterDebounce;
filterSearch.addEventListener("input", () => {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(() => {
    state.page = 1;
    loadLeads();
  }, 250);
});

// ---------- Reports page ----------
const reportsRangeDropdown = document.getElementById("reportsRangeDropdown");
const reportsRangeDropdownTrigger = document.getElementById("reportsRangeDropdownTrigger");
const reportsRangeDropdownPanel = document.getElementById("reportsRangeDropdownPanel");
const reportsRangeDropdownLabel = document.getElementById("reportsRangeDropdownLabel");
const reportsNicheDropdown = document.getElementById("reportsNicheDropdown");
const reportsNicheDropdownTrigger = document.getElementById("reportsNicheDropdownTrigger");
const reportsNicheDropdownPanel = document.getElementById("reportsNicheDropdownPanel");
const reportsNicheDropdownLabel = document.getElementById("reportsNicheDropdownLabel");
const reportsCityDropdown = document.getElementById("reportsCityDropdown");
const reportsCityDropdownTrigger = document.getElementById("reportsCityDropdownTrigger");
const reportsCityDropdownPanel = document.getElementById("reportsCityDropdownPanel");
const reportsCityDropdownLabel = document.getElementById("reportsCityDropdownLabel");
const reportsStatGrid = document.getElementById("reportsStatGrid");
const apiUsageTableBody = document.getElementById("apiUsageTableBody");

const REPORT_RANGE_OPTIONS = [
  { value: "1d", label: "Last 24 hours", color: "#948d80" },
  { value: "7d", label: "Last 7 days", color: "#7fa8d9" },
  { value: "1m", label: "Last 30 days", color: "#e0b355" },
  { value: "3m", label: "Last 3 months", color: "#ff6a3d" },
  { value: "6m", label: "Last 6 months", color: "#c586e0" },
  { value: "1y", label: "Last year", color: "#7fb88a" },
  { value: "all", label: "All time", color: "#4fd1c5" },
];

// Defaults per spec: 1 Day / All niches / All cities
const reportsFilters = { range: "1d", nicheId: "", cityId: "" };
let reportsNichesCities = { niches: [], cities: [] };
let pieChartInstance = null;
let donutChartInstance = null;
let lineChartInstance = null;

function renderReportsRangeDropdown() {
  buildFilterDropdown({
    options: REPORT_RANGE_OPTIONS,
    trigger: reportsRangeDropdownTrigger,
    panel: reportsRangeDropdownPanel,
    label: reportsRangeDropdownLabel,
    currentValue: reportsFilters.range,
    onSelect: (value) => {
      reportsFilters.range = value;
      renderReportsRangeDropdown();
      loadReports();
    },
  });
}

function renderReportsNicheDropdown() {
  const options = [
    { value: "", label: "All niches", color: "#948d80" },
    ...reportsNichesCities.niches.map((n) => ({ value: String(n.id), label: n.name, color: "#7fa8d9" })),
  ];
  buildFilterDropdown({
    options,
    trigger: reportsNicheDropdownTrigger,
    panel: reportsNicheDropdownPanel,
    label: reportsNicheDropdownLabel,
    currentValue: reportsFilters.nicheId,
    onSelect: (value) => {
      reportsFilters.nicheId = value;
      reportsFilters.cityId = ""; // changing niche resets the (now possibly invalid) city selection
      renderReportsNicheDropdown();
      renderReportsCityDropdown();
      loadReports();
    },
  });
}

function renderReportsCityDropdown() {
  const filteredCities = reportsFilters.nicheId
    ? reportsNichesCities.cities.filter((c) => String(c.niche_id) === String(reportsFilters.nicheId))
    : reportsNichesCities.cities;
  const options = [
    { value: "", label: "All cities", color: "#948d80" },
    ...filteredCities.map((c) => ({ value: String(c.id), label: c.name, color: "#7fb88a" })),
  ];
  buildFilterDropdown({
    options,
    trigger: reportsCityDropdownTrigger,
    panel: reportsCityDropdownPanel,
    label: reportsCityDropdownLabel,
    currentValue: reportsFilters.cityId,
    onSelect: (value) => {
      reportsFilters.cityId = value;
      renderReportsCityDropdown();
      loadReports();
    },
  });
}

[reportsRangeDropdownTrigger, reportsNicheDropdownTrigger, reportsCityDropdownTrigger].forEach((trigger, i) => {
  const dd = [reportsRangeDropdown, reportsNicheDropdown, reportsCityDropdown][i];
  trigger.addEventListener("click", () => {
    const wasOpen = dd.classList.contains("open");
    [reportsRangeDropdown, reportsNicheDropdown, reportsCityDropdown].forEach((d) => d.classList.remove("open"));
    if (!wasOpen) dd.classList.add("open");
  });
});
document.addEventListener("click", (e) => {
  [reportsRangeDropdown, reportsNicheDropdown, reportsCityDropdown].forEach((d) => {
    if (!d.contains(e.target)) d.classList.remove("open");
  });
});

const REPORT_STATUS_META = [
  { key: "new", label: "New", color: "#7fa8d9" },
  { key: "shortlisted", label: "Shortlisted", color: "#e0b355" },
  { key: "contacted", label: "Contacted", color: "#ff6a3d" },
  { key: "engaged", label: "Engaged", color: "#c586e0" },
  { key: "converted", label: "Converted", color: "#4fd1c5" },
  { key: "won", label: "Won", color: "#7fb88a" },
  { key: "rejected", label: "Rejected", color: "#d95d5d" },
];

function renderReportsStatGrid(summary) {
  const cards = [
    { label: "Total Hunted", value: summary.total, color: "#ece7dd" },
    ...REPORT_STATUS_META.map((s) => ({ label: s.label, value: summary.byStatus[s.key] || 0, color: s.color })),
  ];
  reportsStatGrid.innerHTML = cards
    .map(
      (c) => `
    <div class="report-stat-card">
      <span class="report-stat-value" style="color:${c.color}">${c.value}</span>
      <span class="report-stat-label">${c.label}</span>
    </div>`
    )
    .join("");
}

function destroyReportsCharts() {
  [pieChartInstance, donutChartInstance, lineChartInstance].forEach((c) => c && c.destroy());
  pieChartInstance = null;
  donutChartInstance = null;
  lineChartInstance = null;
}

function showChartsError(message) {
  ["reportsPieChart", "reportsDonutChart", "reportsLineChart"].forEach((id) => {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.parentElement) return;
    let errorEl = canvas.parentElement.querySelector(".chart-error-msg");
    if (!errorEl) {
      errorEl = document.createElement("div");
      errorEl.className = "chart-error-msg";
      canvas.parentElement.appendChild(errorEl);
    }
    errorEl.textContent = message;
    canvas.style.display = "none";
  });
}

function clearChartsError() {
  document.querySelectorAll(".chart-error-msg").forEach((el) => el.remove());
  ["reportsPieChart", "reportsDonutChart", "reportsLineChart"].forEach((id) => {
    const canvas = document.getElementById(id);
    if (canvas) canvas.style.display = "";
  });
}

function renderReportsCharts(summary, timeseries) {
  if (typeof Chart === "undefined") {
    showChartsError(
      "Charts couldn't load - the Chart.js library was blocked or failed to load from the CDN (cdnjs.cloudflare.com). Try disabling ad-blockers/privacy extensions for this site, or check your network/firewall settings. The numbers above and the table below are unaffected."
    );
    return;
  }
  clearChartsError();

  const labels = REPORT_STATUS_META.map((s) => s.label);
  const data = REPORT_STATUS_META.map((s) => summary.byStatus[s.key] || 0);
  const colors = REPORT_STATUS_META.map((s) => s.color);
  const dataTotal = data.reduce((a, b) => a + b, 0);

  destroyReportsCharts();

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: "#ece7dd", font: { size: 11 }, boxWidth: 10 } },
    },
  };

  // Pie/donut tooltips show both the raw count and the % share of the
  // total, not just the raw value Chart.js shows by default.
  const pieDonutOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.parsed;
            const pct = dataTotal > 0 ? ((value / dataTotal) * 100).toFixed(1) : "0.0";
            return `${ctx.label}: ${value} (${pct}%)`;
          },
        },
      },
    },
  };

  // The reports panel may have just been switched from display:none to
  // visible in this same tick - a canvas measured before the browser has
  // actually laid out its now-visible container comes back as 0x0, and
  // Chart.js silently renders nothing. Two nested requestAnimationFrame
  // calls guarantee at least one full layout+paint has happened first.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const pieCtx = document.getElementById("reportsPieChart");
        const donutCtx = document.getElementById("reportsDonutChart");
        const lineCtx = document.getElementById("reportsLineChart");

        pieChartInstance = new Chart(pieCtx, {
          type: "pie",
          data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#1b1815", borderWidth: 2 }] },
          options: pieDonutOptions,
        });

        donutChartInstance = new Chart(donutCtx, {
          type: "doughnut",
          data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#1b1815", borderWidth: 2 }] },
          options: pieDonutOptions,
        });

        const safeDays = timeseries && Array.isArray(timeseries.days) ? timeseries.days : [];
        const safeSeries = timeseries && timeseries.series ? timeseries.series : {};
        const lineLabels = safeDays.length ? safeDays : ["No data yet"];
        lineChartInstance = new Chart(lineCtx, {
          type: "line",
          data: {
            labels: lineLabels,
            datasets: REPORT_STATUS_META.map((s) => ({
              label: s.label,
              data: safeDays.length ? safeSeries[s.key] || safeDays.map(() => 0) : [0],
              borderColor: s.color,
              backgroundColor: s.color,
              borderWidth: 1.5,
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 5,
            })),
          },
          options: {
            ...commonOptions,
            interaction: { mode: "index", intersect: false },
            plugins: {
              ...commonOptions.plugins,
              tooltip: {
                mode: "index",
                intersect: false,
                callbacks: {
                  title: (items) => items[0]?.label || "",
                  label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`,
                },
              },
            },
            scales: {
              x: { ticks: { color: "#948d80", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
              y: { beginAtZero: true, ticks: { color: "#948d80", precision: 0 }, grid: { color: "rgba(255,255,255,0.05)" } },
            },
          },
        });

        pieChartInstance.resize();
        donutChartInstance.resize();
        lineChartInstance.resize();
      } catch (err) {
        console.error("Failed to render Reports charts:", err);
        showChartsError(`Charts failed to render: ${err.message}. The numbers above and the table below are unaffected.`);
      }
    });
  });
}

function renderApiUsageTable(rows) {
  if (rows.length === 0) {
    apiUsageTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell-row">No API keys saved yet.</td></tr>`;
    return;
  }
  apiUsageTableBody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.label}</td>
      <td>${r.active ? '<span class="api-key-active-badge">● In use</span>' : "Inactive"}</td>
      <td class="mono">${r.requestsMade}</td>
      <td class="mono">${r.leadsCaught}</td>
    </tr>`
    )
    .join("");
}

async function loadReportsFilterOptions() {
  try {
    const res = await api("/api/reports/niches-cities");
    reportsNichesCities = await res.json();
    renderReportsNicheDropdown();
    renderReportsCityDropdown();
  } catch (err) {
    console.error("Failed to load report filter options:", err);
  }
}

async function loadReports() {
  try {
    const params = new URLSearchParams({ range: reportsFilters.range });
    if (reportsFilters.nicheId) params.set("niche", reportsFilters.nicheId);
    if (reportsFilters.cityId) params.set("city", reportsFilters.cityId);

    const [summaryRes, timeseriesRes, usageRes] = await Promise.all([
      api(`/api/reports/summary?${params.toString()}`),
      api(`/api/reports/timeseries?${params.toString()}`),
      api("/api/reports/api-usage"),
    ]);

    if (!summaryRes.ok || !timeseriesRes.ok) {
      throw new Error(`Reports API returned an error (summary: ${summaryRes.status}, timeseries: ${timeseriesRes.status})`);
    }

    const summary = await summaryRes.json();
    const timeseries = await timeseriesRes.json();
    const usage = usageRes.ok ? await usageRes.json() : [];

    renderReportsStatGrid(summary);
    renderReportsCharts(summary, timeseries);
    renderApiUsageTable(usage);
  } catch (err) {
    console.error("Failed to load reports:", err);
    showChartsError(`Couldn't load report data: ${err.message}`);
  }
}

// ---------- Init ----------
(async function init() {
  hideBanner();
  console.log("Prospect app.js loaded — build " + APP_VERSION);
  await loadTheme();
  const versionTag = document.getElementById("versionTag");
  if (versionTag) versionTag.textContent = "build " + APP_VERSION;
  renderStatusDropdown();
  renderNeedDropdown();
  renderSortDropdown();
  renderReportsRangeDropdown();
  renderReportsNicheDropdown();
  renderReportsCityDropdown();
  await loadWhoami();
  const failures = [];

  setContentView("board");

  try {
    await refreshQuota();
  } catch (err) {
    console.error("Failed to load quota:", err);
    failures.push("quota");
  }

  try {
    await loadNichesAndLogs();
  } catch (err) {
    console.error("Failed to load niches/catch logs:", err);
    failures.push("niches");
  }

  updateScopeLine();

  try {
    await loadLeads();
  } catch (err) {
    console.error("Failed to load leads:", err);
    failures.push("leads");
  }

  if (failures.length > 0) {
    showBanner(
      `Couldn't load: ${failures.join(", ")}. Open the browser console (F12) for details, or check the server logs.`
    );
  }
})();
