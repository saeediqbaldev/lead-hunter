const express = require("express");
const { testApiKey } = require("../placesApi");
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

// GET /api/settings/keys -> this user's saved keys (masked), usage stats, and which is active
router.get("/keys", (req, res) => {
  const rows = apiKeys.listKeys(req.session.userId).map(toPublicRow);
  const activeRow = rows.find((r) => r.active);
  res.json({
    keys: rows,
    activeId: activeRow ? activeRow.id : null,
    envFallbackAvailable: !!process.env.GOOGLE_PLACES_API_KEY,
  });
});

// POST /api/settings/keys/test-value { apiKey } -> test a key before saving it
router.post("/keys/test-value", async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: "Enter an API key first." });
  }
  const result = await testApiKey(apiKey.trim());
  res.json(result);
});

// POST /api/settings/keys { label, apiKey } -> test, and only save if it works
router.post("/keys", async (req, res) => {
  const { label, apiKey } = req.body || {};
  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ error: "apiKey is required" });
  }

  const trimmedKey = apiKey.trim();
  const trimmedLabel = (label && label.trim()) || "Untitled key";

  const result = await testApiKey(trimmedKey);
  if (!result.ok) {
    return res.status(400).json({ error: result.error || "Key test failed", tested: true });
  }

  const row = apiKeys.insertKey(req.session.userId, trimmedLabel, trimmedKey);
  res.json(toPublicRow(row));
});

// POST /api/settings/keys/:id/test -> re-test a saved key
router.post("/keys/:id/test", async (req, res) => {
  const row = apiKeys.getKeyById(req.session.userId, req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: "Key not found" });
  const result = await testApiKey(row.key_value);
  res.json(result);
});

// POST /api/settings/keys/:id/activate -> make this the key searches use
router.post("/keys/:id/activate", (req, res) => {
  const row = apiKeys.getKeyById(req.session.userId, req.params.id);
  if (!row) return res.status(404).json({ error: "Key not found" });
  apiKeys.setActive(req.session.userId, row.id);
  res.json({ ok: true, activeId: row.id });
});

// DELETE /api/settings/keys/:id
router.delete("/keys/:id", (req, res) => {
  const row = apiKeys.getKeyById(req.session.userId, req.params.id);
  if (!row) return res.status(404).json({ error: "Key not found" });
  apiKeys.deleteKey(req.session.userId, row.id);
  res.json({ ok: true });
});

module.exports = router;
