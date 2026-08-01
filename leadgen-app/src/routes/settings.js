const express = require("express");
const asyncHandler = require("../asyncHandler");
const { testApiKey: testPlacesKey } = require("../placesApi");
const { testApiKey: testGeminiKey } = require("../gemini");
const { groqClient, deepseekClient } = require("../openaiCompatible");
const apiKeys = require("../apiKeys");
const db = require("../db");

const router = express.Router();

// GET /api/settings/daily-cap -> this user's own daily lead cap
router.get("/daily-cap", (req, res) => {
  const row = db.prepare("SELECT daily_lead_cap FROM users WHERE id = ?").get(req.session.userId);
  res.json({ dailyLeadCap: (row && row.daily_lead_cap) || 300 });
});

// PUT /api/settings/daily-cap { dailyLeadCap }
router.put("/daily-cap", (req, res) => {
  const value = Number(req.body.dailyLeadCap);
  if (!Number.isFinite(value) || value < 1 || value > 5000) {
    return res.status(400).json({ error: "Enter a number between 1 and 5000" });
  }
  db.prepare("UPDATE users SET daily_lead_cap = ? WHERE id = ?").run(Math.round(value), req.session.userId);
  res.json({ dailyLeadCap: Math.round(value) });
});

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

function toPublicRow(row) {
  return {
    id: row.id,
    label: row.label,
    masked: maskKey(row.key_value),
    active: !!row.is_active,
    requestsMade: row.requests_made || 0,
    leadsCaught: row.leads_caught || 0,
    createdAt: row.created_at,
  };
}

// Shared CRUD logic for a provider's API keys - both Google Places and
// Gemini keys go through the exact same save/test/activate/delete/list
// flow, just scoped to their own provider and their own key-testing
// function. Mounted twice below instead of duplicating this route set.
function createKeyRoutes(provider, testFn, envFallbackVar) {
  const sub = express.Router();

  sub.get("/", (req, res) => {
    const rows = apiKeys.listKeys(req.session.userId, provider).map(toPublicRow);
    const activeRow = rows.find((r) => r.active);
    res.json({
      keys: rows,
      activeId: activeRow ? activeRow.id : null,
      envFallbackAvailable: envFallbackVar ? !!process.env[envFallbackVar] : false,
    });
  });

  sub.post("/test-value", asyncHandler(async (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ ok: false, error: "Enter an API key first." });
    }
    const result = await testFn(apiKey.trim());
    res.json(result);
  }));

  sub.post("/", asyncHandler(async (req, res) => {
    const { label, apiKey } = req.body || {};
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    const trimmedKey = apiKey.trim();
    const trimmedLabel = (label && label.trim()) || "Untitled key";

    const result = await testFn(trimmedKey);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Key test failed", tested: true });
    }

    const row = apiKeys.insertKey(req.session.userId, trimmedLabel, trimmedKey, provider);
    res.json(toPublicRow(row));
  }));

  sub.post("/:id/test", asyncHandler(async (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Key not found" });
    const result = await testFn(row.key_value);
    res.json(result);
  }));

  sub.post("/:id/activate", (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ error: "Key not found" });
    apiKeys.setActive(req.session.userId, row.id, provider);
    res.json({ ok: true, activeId: row.id });
  });

  sub.delete("/:id", (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ error: "Key not found" });
    apiKeys.deleteKey(req.session.userId, row.id);
    res.json({ ok: true });
  });

  return sub;
}

// Google Places keys (existing behavior, paths unchanged: /api/settings/keys/...)
router.use("/keys", createKeyRoutes("google_places", testPlacesKey, "GOOGLE_PLACES_API_KEY"));

// Gemini keys (new: /api/settings/gemini-keys/...) - used for business
// deep-analysis and outreach content generation.
router.use("/gemini-keys", createKeyRoutes("gemini", testGeminiKey, null));

// Groq keys (new: /api/settings/groq-keys/...) and DeepSeek keys (new:
// /api/settings/deepseek-keys/...) - both used as fallback AI providers
// alongside Gemini for business analysis and content generation.
router.use("/groq-keys", createKeyRoutes("groq", groqClient.testApiKey, null));
router.use("/deepseek-keys", createKeyRoutes("deepseek", deepseekClient.testApiKey, null));

// GET /api/settings/usage-summary -> this month's usage totals for both
// providers, for the "Limits Usage" page.
router.get("/usage-summary", (req, res) => {
  const providers = ["google_places", "gemini", "groq", "deepseek"];
  const result = {};
  for (const p of providers) {
    result[p] = apiKeys.currentMonthUsage(req.session.userId, p);
  }
  res.json(result);
});

// GET /api/settings/usage-history?provider=gemini|groq|deepseek|google_places
// -> all-time totals per key + a daily timeseries, same shape the Reports
// page's chart already uses, reused here for the Limits Usage page's
// per-provider charts (and embedded on each provider's own Settings page).
router.get("/usage-history", (req, res) => {
  const provider = ["google_places", "gemini", "groq", "deepseek"].includes(req.query.provider) ? req.query.provider : "gemini";
  const allTime = apiKeys.allTimeUsage(req.session.userId, provider);
  const daily = apiKeys.dailyUsageHistory(req.session.userId, 90, provider);

  const days = Array.from(new Set(daily.map((d) => d.usage_date))).sort();
  const byKey = {};
  for (const row of allTime) {
    byKey[row.id] = {
      id: row.id,
      label: row.label,
      active: !!row.is_active,
      totalRequests: row.requests_made || 0,
      totalLeads: row.leads_caught || 0,
      requestsSeries: days.map(() => 0),
    };
  }
  daily.forEach((row) => {
    const entry = byKey[row.api_key_id];
    if (!entry) return;
    const dayIndex = days.indexOf(row.usage_date);
    if (dayIndex === -1) return;
    entry.requestsSeries[dayIndex] = row.requests_made || 0;
  });

  res.json({ days, keys: Object.values(byKey) });
});

module.exports = router;
