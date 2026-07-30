const express = require("express");
const db = require("../db");

const router = express.Router();

const RANGE_DAYS = {
  "1d": 1,
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  all: null,
};

function rangeStartDate(rangeKey) {
  const days = RANGE_DAYS[rangeKey];
  if (!days) return null; // "all time" - no lower bound
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}

// GET /api/reports/summary?range=7d|1m|3m|6m|1y|all
// Counts every lead this user owns (via niches -> catch_logs -> leads),
// broken down by status, restricted to leads created within the range.
router.get("/summary", (req, res) => {
  const userId = req.session.userId;
  const range = RANGE_DAYS.hasOwnProperty(req.query.range) ? req.query.range : "1m";
  const startDate = rangeStartDate(range);

  let query = `
    SELECT l.status, COUNT(*) AS c
    FROM leads l
    JOIN catch_logs cl ON cl.id = l.catch_log_id
    JOIN niches n ON n.id = cl.niche_id
    WHERE n.user_id = ?
  `;
  const params = [userId];
  if (startDate) {
    query += " AND l.created_at >= ?";
    params.push(startDate);
  }
  query += " GROUP BY l.status";

  const rows = db.prepare(query).all(...params);
  const byStatus = { new: 0, shortlisted: 0, contacted: 0, engaged: 0, converted: 0, won: 0, rejected: 0 };
  let total = 0;
  for (const row of rows) {
    if (byStatus.hasOwnProperty(row.status)) byStatus[row.status] = row.c;
    total += row.c;
  }

  // Per-niche breakdown, same range, for the tabular view
  let nicheQuery = `
    SELECT n.name AS niche_name, cl.name AS city_name, l.status, COUNT(*) AS c
    FROM leads l
    JOIN catch_logs cl ON cl.id = l.catch_log_id
    JOIN niches n ON n.id = cl.niche_id
    WHERE n.user_id = ?
  `;
  const nicheParams = [userId];
  if (startDate) {
    nicheQuery += " AND l.created_at >= ?";
    nicheParams.push(startDate);
  }
  nicheQuery += " GROUP BY n.id, cl.id, l.status ORDER BY n.name ASC, cl.name ASC";

  const nicheRows = db.prepare(nicheQuery).all(...nicheParams);
  const byNicheCity = new Map(); // "niche||city" -> { niche, city, ...statusCounts, total }
  for (const row of nicheRows) {
    const key = `${row.niche_name}||${row.city_name}`;
    if (!byNicheCity.has(key)) {
      byNicheCity.set(key, {
        niche: row.niche_name,
        city: row.city_name,
        new: 0,
        shortlisted: 0,
        contacted: 0,
        engaged: 0,
        converted: 0,
        won: 0,
        rejected: 0,
        total: 0,
      });
    }
    const entry = byNicheCity.get(key);
    if (entry.hasOwnProperty(row.status)) entry[row.status] = row.c;
    entry.total += row.c;
  }

  res.json({
    range,
    total,
    byStatus,
    byNicheCity: Array.from(byNicheCity.values()),
  });
});

// GET /api/reports/api-usage -> this user's saved API keys with usage totals
// (reuses the same numbers Settings already shows, surfaced here for a
// combined at-a-glance view alongside the lead pipeline stats)
router.get("/api-usage", (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, label, requests_made, leads_caught, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at ASC"
    )
    .all(req.session.userId);

  res.json(
    rows.map((r) => ({
      id: r.id,
      label: r.label,
      requestsMade: r.requests_made || 0,
      leadsCaught: r.leads_caught || 0,
      active: !!r.is_active,
    }))
  );
});

module.exports = router;
