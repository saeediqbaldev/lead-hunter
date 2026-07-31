const express = require("express");
const db = require("../db");
const apiKeys = require("../apiKeys");

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

const STATUS_KEYS = ["new", "shortlisted", "contacted", "engaged", "converted", "won", "rejected"];

// Shared filter builder for both /summary and /timeseries - keeps the two
// endpoints scoped identically to whatever range/niche/city is selected.
function buildFilteredQuery(userId, query) {
  const { niche, city } = query;
  const range = RANGE_DAYS.hasOwnProperty(query.range) ? query.range : "1d";
  const startDate = rangeStartDate(range);

  let sql = `
    FROM leads l
    JOIN catch_logs cl ON cl.id = l.catch_log_id
    JOIN niches n ON n.id = cl.niche_id
    WHERE n.user_id = ?
  `;
  const params = [userId];

  if (startDate) {
    sql += " AND l.created_at >= ?";
    params.push(startDate);
  }
  if (niche) {
    sql += " AND n.id = ?";
    params.push(niche);
  }
  if (city) {
    sql += " AND cl.id = ?";
    params.push(city);
  }

  return { sql, params, range };
}

// GET /api/reports/summary?range=1d|7d|1m|3m|6m|1y|all&niche=&city=
router.get("/summary", (req, res) => {
  const userId = req.session.userId;
  const { sql, params, range } = buildFilteredQuery(userId, req.query);

  const rows = db.prepare(`SELECT l.status, COUNT(*) AS c ${sql} GROUP BY l.status`).all(...params);
  const byStatus = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  let total = 0;
  for (const row of rows) {
    if (byStatus.hasOwnProperty(row.status)) byStatus[row.status] = row.c;
    total += row.c;
  }

  res.json({ range, total, byStatus });
});

// GET /api/reports/timeseries?range=&niche=&city=
// Daily-bucketed counts per status, for the line chart. Bucket size is
// always one day regardless of range - for "all time" on an old account
// this could be a lot of points, but that's a reasonable tradeoff for
// keeping the query simple and the chart meaningful at every range.
router.get("/timeseries", (req, res) => {
  const userId = req.session.userId;
  const { sql, params, range } = buildFilteredQuery(userId, req.query);

  const rows = db
    .prepare(`SELECT date(l.created_at) AS day, l.status, COUNT(*) AS c ${sql} GROUP BY day, l.status ORDER BY day ASC`)
    .all(...params);

  const dayMap = new Map(); // day -> {status: count}
  for (const row of rows) {
    if (!dayMap.has(row.day)) dayMap.set(row.day, {});
    dayMap.get(row.day)[row.status] = row.c;
  }

  const days = Array.from(dayMap.keys()).sort();
  const series = Object.fromEntries(STATUS_KEYS.map((k) => [k, days.map((d) => dayMap.get(d)[k] || 0)]));

  res.json({ range, days, series });
});

// GET /api/reports/niches-cities -> flat list for the Reports page filter dropdowns
router.get("/niches-cities", (req, res) => {
  const userId = req.session.userId;
  const niches = db.prepare("SELECT id, name FROM niches WHERE user_id = ? ORDER BY name ASC").all(userId);
  const cities = db
    .prepare(
      `SELECT cl.id, cl.name, cl.niche_id FROM catch_logs cl
       JOIN niches n ON n.id = cl.niche_id
       WHERE n.user_id = ? ORDER BY cl.name ASC`
    )
    .all(userId);
  res.json({ niches, cities });
});

// GET /api/reports/api-usage -> TODAY's usage specifically (not all-time totals)
router.get("/api-usage", (req, res) => {
  const rows = apiKeys.todaysUsage(req.session.userId);
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
