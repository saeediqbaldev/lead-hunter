const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/automation/status -> whether it's enabled, the current/most
// recent run with its full timeline, and a short recent-runs history.
router.get("/status", (req, res) => {
  const userId = req.session.userId;
  const settingsRow = db.prepare("SELECT enabled FROM automation_settings WHERE user_id = ?").get(userId);
  const enabled = !!settingsRow?.enabled;

  const currentRun = db.prepare("SELECT * FROM automation_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
  let currentRunPayload = null;
  if (currentRun) {
    const timeline = db.prepare("SELECT event_type, message, created_at FROM automation_timeline_events WHERE run_id = ? ORDER BY id ASC").all(currentRun.id);
    currentRunPayload = { ...currentRun, timeline };
  }

  const recentRuns = db
    .prepare("SELECT id, run_date, niche_name, country, status, campaign_id FROM automation_runs WHERE user_id = ? ORDER BY id DESC LIMIT 10")
    .all(userId);

  res.json({ enabled, currentRun: currentRunPayload, recentRuns });
});

// PUT /api/automation/settings { enabled }
router.put("/settings", (req, res) => {
  const { enabled } = req.body || {};
  db.prepare(
    `INSERT INTO automation_settings (user_id, enabled, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).run(req.session.userId, enabled ? 1 : 0);
  res.json({ enabled: !!enabled });
});

module.exports = router;
