// Bump this on every meaningful change - shown in the topbar and console so
// you can immediately confirm the browser is running the build you just deployed.
const APP_VERSION = "2026.07.30-9";

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
const settingsBtn = document.getElementById("settingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const apiKeysList = document.getElementById("apiKeysList");
const newKeyLabel = document.getElementById("newKeyLabel");
const newKeyValue = document.getElementById("newKeyValue");
const settingsResult = document.getElementById("settingsResult");
const settingsCancelBtn = document.getElementById("settingsCancelBtn");
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

settingsBtn.addEventListener("click", async () => {
  newKeyLabel.value = "";
  newKeyValue.value = "";
  hideSettingsResult();
  settingsOverlay.style.display = "flex";
  await loadApiKeys();
});

function closeSettingsModal() {
  settingsOverlay.style.display = "none";
}

settingsCancelBtn.addEventListener("click", closeSettingsModal);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettingsModal();
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

const themeBtn = document.getElementById("themeBtn");
const themeOverlay = document.getElementById("themeOverlay");
const themeColorGrid = document.getElementById("themeColorGrid");
const themeResult = document.getElementById("themeResult");
const themeCancelBtn = document.getElementById("themeCancelBtn");
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

themeBtn.addEventListener("click", () => {
  themeResult.style.display = "none";
  themeOverlay.style.display = "flex";
  renderThemeEditor();
});

function closeThemeModal() {
  themeOverlay.style.display = "none";
}
themeCancelBtn.addEventListener("click", async () => {
  await loadTheme(); // revert any unsaved live-preview changes
  closeThemeModal();
});
themeOverlay.addEventListener("click", async (e) => {
  if (e.target === themeOverlay) {
    await loadTheme();
    closeThemeModal();
  }
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
const adminBtn = document.getElementById("adminBtn");
const adminOverlay = document.getElementById("adminOverlay");
const usersList = document.getElementById("usersList");
const newUsername = document.getElementById("newUsername");
const newUserPassword = document.getElementById("newUserPassword");
const newUserIsAdmin = document.getElementById("newUserIsAdmin");
const adminResult = document.getElementById("adminResult");
const adminCancelBtn = document.getElementById("adminCancelBtn");
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
    adminBtn.style.display = data.role === "admin" ? "inline-block" : "none";
  } catch (err) {
    console.error("Failed to load current user:", err);
  }
}

adminBtn.addEventListener("click", async () => {
  newUsername.value = "";
  newUserPassword.value = "";
  newUserIsAdmin.checked = false;
  hideAdminResult();
  adminOverlay.style.display = "flex";
  await loadUsers();
});

function closeAdminModal() {
  adminOverlay.style.display = "none";
}
adminCancelBtn.addEventListener("click", closeAdminModal);
adminOverlay.addEventListener("click", (e) => {
  if (e.target === adminOverlay) closeAdminModal();
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
const outreachTabs = document.getElementById("outreachTabs");
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

const tabButtons = document.querySelectorAll(".tab-btn");
const tabHunt = document.getElementById("tab-hunt");
const tabNiches = document.getElementById("tab-niches");

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
  outreachSummaries: new Map(), // nicheId -> [{catchLogId, catchLogName, shortlisted, contacted, won}]
};

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

// ---------- Color legend toggle ----------
document.getElementById("legendToggleBtn").addEventListener("click", () => {
  const panel = document.getElementById("legendPanel");
  panel.style.display = panel.style.display === "none" ? "flex" : "none";
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

scrapeBtn.addEventListener("click", async () => {
  const catchLogId = scrapeBtn.dataset.catchLogId;
  if (!catchLogId) return;

  scrapePanel.style.display = "block";
  scrapeStatusLine.textContent = "Starting…";
  scrapeBtn.disabled = true;

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
    scrapeBtn.disabled = false;
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

// ---------- Tabs ----------
const tabOutreach = document.getElementById("tab-outreach");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tabHunt.style.display = "none";
    tabNiches.style.display = "none";
    tabOutreach.style.display = "none";

    if (btn.dataset.tab === "hunt") {
      tabHunt.style.display = "block";
      setBoardMode("board");
    } else if (btn.dataset.tab === "niches") {
      tabNiches.style.display = "block";
      setBoardMode("board");
    } else {
      tabOutreach.style.display = "block";
      setBoardMode("outreach");
      await renderOutreachTree();
    }
  });
});

function setBoardMode(mode) {
  state.mode = mode;
  state.page = 1;
  if (mode === "outreach") {
    boardFilters.style.display = "none";
    outreachTabs.style.display = "flex";
    document.querySelectorAll(".outreach-tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.status === state.outreach.status);
    });
  } else {
    boardFilters.style.display = "flex";
    outreachTabs.style.display = "none";
  }
  updateScopeLine();
  loadLeads();
}

document.querySelectorAll(".outreach-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.outreach.status = btn.dataset.status;
    state.page = 1;
    document.querySelectorAll(".outreach-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    updateScopeLine();
    loadLeads();
  });
});

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
            <button class="icon-btn" data-action="rename-log" data-id="${log.id}" title="Rename">✎</button>
            <button class="icon-btn" data-action="delete-log" data-id="${log.id}" title="Delete">✕</button>
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
            <button class="icon-btn" data-action="rename-niche" data-id="${niche.id}" title="Rename">✎</button>
            <button class="icon-btn" data-action="delete-niche" data-id="${niche.id}" title="Delete">✕</button>
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
  updateScopeLine();
  renderNichesTree();
  renderQuickNicheDropdown();
  renderQuickCityDropdown();
  await loadLeads();
});

// ---------- Outreach Report tree ----------
async function getOutreachSummary(nicheId) {
  if (state.outreachSummaries.has(nicheId)) return state.outreachSummaries.get(nicheId);
  const res = await api(`/api/niches/${nicheId}/outreach-summary`);
  const summary = await res.json();
  state.outreachSummaries.set(nicheId, summary);
  return summary;
}

async function renderOutreachTree() {
  if (state.niches.length === 0) {
    outreachTree.innerHTML = `<div class="empty-state">No niches yet. Create one in the Hunt tab first.</div>`;
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
              .map(
                (city) => `
            <div class="catchlog-row outreach-city-row ${city.catchLogId === state.outreach.catchLogId ? "active" : ""}" data-niche-id="${niche.id}" data-log-id="${city.catchLogId}">
              <div class="catchlog-name">${city.catchLogName}</div>
              <div class="outreach-badges">
                <span class="outreach-badge shortlisted" title="Shortlisted">${city.shortlisted}</span>
                <span class="outreach-badge contacted" title="Contacted">${city.contacted}</span>
                <span class="outreach-badge engaged" title="Engaged">${city.engaged}</span>
                <span class="outreach-badge converted" title="Converted">${city.converted}</span>
                <span class="outreach-badge won" title="Won">${city.won}</span>
              </div>
            </div>`
              )
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
  const toggleRow = e.target.closest('[data-action="toggle-outreach-niche"]');
  if (toggleRow) {
    const nicheId = Number(toggleRow.dataset.id);
    if (state.outreachOpenNicheIds.has(nicheId)) state.outreachOpenNicheIds.delete(nicheId);
    else state.outreachOpenNicheIds.add(nicheId);
    await renderOutreachTree();
    return;
  }

  const cityRow = e.target.closest(".outreach-city-row");
  if (cityRow) {
    state.outreach.nicheId = Number(cityRow.dataset.nicheId);
    state.outreach.catchLogId = Number(cityRow.dataset.logId);
    state.page = 1;
    await renderOutreachTree();
    updateScopeLine();
    await loadLeads();
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
  scrapeBtn.style.display = id ? "inline-flex" : "none";
  scrapeBtn.dataset.catchLogId = id || "";
}

function updateScopeLine() {
  updateScrapeButtonVisibility();

  if (state.mode === "outreach") {
    const log = state.outreach.catchLogId
      ? findOutreachCatchLog(state.outreach.catchLogId)
      : null;
    if (!log) {
      scopeLine.innerHTML = "Outreach Report — <strong>pick a niche and city</strong>";
    } else {
      scopeLine.innerHTML = `Outreach Report: <strong>${log.nicheName} / ${log.catchLogName}</strong>`;
    }
    return;
  }

  if (state.activeCatchLogId) {
    const log = state.catchLogs.find((l) => l.id === state.activeCatchLogId);
    const niche = log ? state.niches.find((n) => n.id === log.niche_id) : null;
    scopeLine.innerHTML = `Viewing: <strong>${niche ? niche.name : "?"} / ${log ? log.name : "?"}</strong>`;
    clearScopeBtn.style.display = "inline-block";
    return;
  }

  if (state.activeNicheId) {
    const niche = state.niches.find((n) => n.id === state.activeNicheId);
    scopeLine.innerHTML = `Viewing: <strong>${niche ? niche.name : "?"} (all cities)</strong>`;
    clearScopeBtn.style.display = "inline-block";
    return;
  }

  scopeLine.innerHTML = "Viewing: <strong>All records</strong>";
  clearScopeBtn.style.display = "none";
}

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

const WHATSAPP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12.02 2C6.5 2 2.02 6.48 2.02 12c0 1.85.5 3.58 1.36 5.07L2 22l5.06-1.33A9.94 9.94 0 0 0 12.02 22C17.54 22 22 17.52 22 12S17.54 2 12.02 2zm0 18.1c-1.62 0-3.13-.47-4.4-1.28l-.31-.19-3 .79.8-2.92-.2-.3A8.07 8.07 0 0 1 3.9 12c0-4.48 3.65-8.1 8.12-8.1 4.47 0 8.1 3.63 8.1 8.1s-3.63 8.1-8.1 8.1zm4.44-6.06c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.55.12-.16.24-.63.78-.77.94-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.8-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.43-.58 1.63-1.15.2-.56.2-1.04.14-1.15-.06-.1-.22-.16-.46-.28z"/></svg>`;

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

    // Update in place immediately - snappier than a full re-render, and the
    // rest of the row (needs/rating/etc.) doesn't depend on status anyway.
    dd.querySelector(".row-status-label").textContent = value;
    dd.querySelector(".row-status-trigger").style.setProperty("--status-color", color);
    dd.querySelectorAll("[data-value]").forEach((el) => el.classList.toggle("selected", el.dataset.value === value));
    dd.classList.remove("open");

    api(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    })
      .then(async () => {
        // Outreach Report badge counts and the currently-viewed list both
        // depend on status, so refresh them - a lead moving from
        // "shortlisted" to "contacted" should vanish from the Shortlisted
        // tab and the badge counts should update next time the tree opens.
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

const LOCATION_PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;

// Order matches the requested spec: Email, FB, Insta, Phone, LinkedIn, TikTok
const SOCIAL_SVGS = {
  email: `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="1" y="3" width="22" height="18" rx="3" fill="#5a5550"/><path d="M2 5.5 12 13l10-7.5" fill="none" stroke="#fff" stroke-width="1.6"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="11" fill="#3b5998"/><text x="12" y="16.5" text-anchor="middle" font-size="12" font-family="Georgia, serif" fill="#fff" font-weight="bold">f</text></svg>`,
  instagram: `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="1" y="1" width="22" height="22" rx="6" fill="#c8347a"/><rect x="6" y="6" width="12" height="12" rx="4" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="17.3" cy="6.7" r="1.1" fill="#fff"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="11" fill="#4caf6d"/><path d="M8 7.5c.3-.7.9-1 1.6-1h1c.5 0 .9.4 1 .9l.4 2c.1.4-.1.9-.4 1.1l-.9.7c.7 1.6 2 2.9 3.6 3.6l.7-.9c.3-.3.7-.5 1.1-.4l2 .4c.5.1.9.5.9 1v1c0 .7-.3 1.3-1 1.6-3 .6-8.2-1.7-9.6-6.2-.4-1.2-.6-2.8-.4-3.8Z" fill="none" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="1" y="1" width="22" height="22" rx="4" fill="#0a66c2"/><text x="12" y="16" text-anchor="middle" font-size="9" font-family="Arial, sans-serif" fill="#fff" font-weight="bold">in</text></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="1" y="1" width="22" height="22" rx="6" fill="#111"/><path d="M13.5 6.5v7.3a2.4 2.4 0 1 1-2-2.36" fill="none" stroke="#25f4ee" stroke-width="1.3"/><path d="M13.2 6.3v7.3a2.4 2.4 0 1 1-2-2.36" fill="none" stroke="#fe2c55" stroke-width="1.3"/><path d="M13.35 6.4c.2 1.4 1.2 2.4 2.65 2.5" fill="none" stroke="#fff" stroke-width="1.3"/></svg>`,
};

function socialLinksHtml(lead) {
  const socials = lead.socials || {};
  const items = [];

  if (socials.email) {
    items.push(`<a href="mailto:${socials.email}" class="social-icon" title="Email: ${socials.email}">${SOCIAL_SVGS.email}</a>`);
  }
  if (socials.facebook) {
    items.push(`<a href="${socials.facebook}" target="_blank" rel="noopener" class="social-icon" title="Facebook">${SOCIAL_SVGS.facebook}</a>`);
  }
  if (socials.instagram) {
    items.push(`<a href="${socials.instagram}" target="_blank" rel="noopener" class="social-icon" title="Instagram">${SOCIAL_SVGS.instagram}</a>`);
  }
  // Uses the scraper's own tel: link finding, not the Google-Places phone
  // already shown in the Contact column - this icon specifically means "we
  // independently confirmed a click-to-call link on their own website."
  if (socials.phone) {
    items.push(`<a href="tel:${socials.phone.replace(/\s+/g, "")}" class="social-icon" title="Call ${socials.phone} (found on their website)">${SOCIAL_SVGS.phone}</a>`);
  }
  if (socials.linkedin) {
    items.push(`<a href="${socials.linkedin}" target="_blank" rel="noopener" class="social-icon" title="LinkedIn">${SOCIAL_SVGS.linkedin}</a>`);
  }
  if (socials.tiktok) {
    items.push(`<a href="${socials.tiktok}" target="_blank" rel="noopener" class="social-icon" title="TikTok">${SOCIAL_SVGS.tiktok}</a>`);
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
      : `<span class="rating-val"><small>not pulled</small></span>`;

    row.innerHTML = `
      <div class="col-sn">${startIndex + index + 1}</div>
      <div>
        <div class="lead-name-row">
          ${locationHtml}
          <span class="lead-name" title="${lead.name}">${lead.name}</span>
        </div>
      </div>
      <div><div class="contact-row">${websiteHtml}<br/>${phoneHtml}</div></div>
      <div>${needsDotsHtml(lead)}</div>
      <div><div class="social-row">${socialLinksHtml(lead)}</div></div>
      <div>${ratingHtml}</div>
      <div>${rowStatusDropdownHtml(lead)}</div>
      <div class="row-actions"><button data-action="delete" data-id="${lead.id}" title="Remove">✕</button></div>
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
      await api(`/api/leads/${id}`, { method: "DELETE" });
      await loadLeads();
      await loadNichesAndLogs();
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
  await loadWhoami();
  const failures = [];

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
