const express = require("express");
const db = require("../db");

const router = express.Router();

const BACKUP_FORMAT_VERSION = 1;

// GET /api/backup/export -> a single JSON file with everything this account owns:
// niches, catch logs, leads, seen_places (dedup history), API keys (including
// the actual key values - this file is downloaded by the account owner, so
// that's expected, but the UI clearly warns about it), theme, and daily cap.
// search_log (daily quota history) is intentionally excluded - it's derived
// bookkeeping, not user data, and re-importing it could confuse "today's"
// pulled count.
router.get("/export", (req, res) => {
  const userId = req.session.userId;

  const user = db.prepare("SELECT username, theme, daily_lead_cap FROM users WHERE id = ?").get(userId);
  const niches = db.prepare("SELECT * FROM niches WHERE user_id = ?").all(userId);

  const nicheIds = niches.map((n) => n.id);
  const catchLogs = nicheIds.length
    ? db
        .prepare(`SELECT * FROM catch_logs WHERE niche_id IN (${nicheIds.map(() => "?").join(",")})`)
        .all(...nicheIds)
    : [];

  const catchLogIds = catchLogs.map((c) => c.id);
  const leads = catchLogIds.length
    ? db
        .prepare(`SELECT * FROM leads WHERE catch_log_id IN (${catchLogIds.map(() => "?").join(",")})`)
        .all(...catchLogIds)
    : [];

  const seenPlaces = db.prepare("SELECT niche_id, location_key, place_id, first_seen_at FROM seen_places WHERE user_id = ?").all(userId);
  const apiKeys = db
    .prepare("SELECT label, key_value, is_active, requests_made, leads_caught FROM api_keys WHERE user_id = ?")
    .all(userId);

  const backup = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    username: user.username,
    theme: user.theme ? JSON.parse(user.theme) : null,
    dailyLeadCap: user.daily_lead_cap || 300,
    niches,
    catchLogs,
    leads,
    seenPlaces,
    apiKeys,
  };

  const filename = `xeven-leads-backup-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(JSON.stringify(backup, null, 2));
});

// POST /api/backup/import - body is the backup JSON itself.
// MERGES into the current account (never deletes anything already there):
//   - niches matched by name, reused if they already exist
//   - catch logs matched by (niche, normalized location) - same rule the
//     app already uses everywhere else, so imported cities line up with any
//     you've already hunted since the backup was taken
//   - leads matched by (catch_log, place_id) - existing local leads are
//     left untouched (their status/notes win), only genuinely new
//     businesses from the backup get inserted
//   - API keys matched by key value - skipped if you already have that key
//     saved, added as inactive (not auto-switched) otherwise
//   - theme and daily cap are restored directly (there's only one of each
//     per account, so "merge" doesn't really apply to them)
router.post("/import", (req, res) => {
  const userId = req.session.userId;
  const backup = req.body;

  if (!backup || !Array.isArray(backup.niches)) {
    return res.status(400).json({ error: "This doesn't look like a valid Xeven Leads backup file." });
  }

  function normLoc(loc) {
    return (loc || "").trim().toLowerCase().replace(/[,\s]+/g, " ");
  }

  const stats = { niches: 0, catchLogs: 0, leads: 0, apiKeys: 0 };

  const importTx = db.transaction(() => {
    const nicheIdMap = new Map(); // backup niche id -> real (existing or new) niche id

    for (const niche of backup.niches) {
      let existing = db.prepare("SELECT * FROM niches WHERE user_id = ? AND name = ?").get(userId, niche.name);
      if (!existing) {
        const info = db.prepare("INSERT INTO niches (user_id, name) VALUES (?, ?)").run(userId, niche.name);
        existing = { id: info.lastInsertRowid };
        stats.niches++;
      }
      nicheIdMap.set(niche.id, existing.id);
    }

    const catchLogIdMap = new Map(); // backup catch_log id -> real catch_log id

    for (const log of backup.catchLogs || []) {
      const realNicheId = nicheIdMap.get(log.niche_id);
      if (!realNicheId) continue; // orphaned reference in the backup file, skip safely

      const existingLogs = db.prepare("SELECT * FROM catch_logs WHERE niche_id = ?").all(realNicheId);
      let match = log.location
        ? existingLogs.find((l) => normLoc(l.location) === normLoc(log.location))
        : existingLogs.find((l) => l.name === log.name);

      if (!match) {
        const info = db
          .prepare("INSERT INTO catch_logs (niche_id, name, keyword, location) VALUES (?, ?, ?, ?)")
          .run(realNicheId, log.name, log.keyword || null, log.location || null);
        match = { id: info.lastInsertRowid };
        stats.catchLogs++;
      }
      catchLogIdMap.set(log.id, match.id);
    }

    const insertLead = db.prepare(`
      INSERT INTO leads (catch_log_id, place_id, name, address, phone, website, rating, review_count, business_status, needs, socials, status, notes, created_at)
      VALUES (@catch_log_id, @place_id, @name, @address, @phone, @website, @rating, @review_count, @business_status, @needs, @socials, @status, @notes, @created_at)
      ON CONFLICT(catch_log_id, place_id) DO NOTHING
    `);

    for (const lead of backup.leads || []) {
      const realCatchLogId = catchLogIdMap.get(lead.catch_log_id);
      if (!realCatchLogId) continue;

      const info = insertLead.run({
        catch_log_id: realCatchLogId,
        place_id: lead.place_id,
        name: lead.name,
        address: lead.address,
        phone: lead.phone,
        website: lead.website,
        rating: lead.rating,
        review_count: lead.review_count,
        business_status: lead.business_status,
        needs: lead.needs,
        socials: lead.socials,
        status: lead.status || "new",
        notes: lead.notes,
        created_at: lead.created_at,
      });
      if (info.changes > 0) stats.leads++;
    }

    const insertSeen = db.prepare(
      "INSERT OR IGNORE INTO seen_places (user_id, niche_id, location_key, place_id) VALUES (?, ?, ?, ?)"
    );
    for (const seen of backup.seenPlaces || []) {
      const realNicheId = nicheIdMap.get(seen.niche_id);
      if (!realNicheId) continue;
      insertSeen.run(userId, realNicheId, seen.location_key, seen.place_id);
    }

    for (const key of backup.apiKeys || []) {
      const already = db
        .prepare("SELECT 1 FROM api_keys WHERE user_id = ? AND key_value = ?")
        .get(userId, key.key_value);
      if (already) continue;
      db.prepare(
        "INSERT INTO api_keys (user_id, label, key_value, is_active, requests_made, leads_caught) VALUES (?, ?, ?, 0, ?, ?)"
      ).run(userId, key.label || "Imported key", key.key_value, key.requests_made || 0, key.leads_caught || 0);
      stats.apiKeys++;
    }

    if (backup.theme) {
      db.prepare("UPDATE users SET theme = ? WHERE id = ?").run(JSON.stringify(backup.theme), userId);
    }
    if (backup.dailyLeadCap) {
      db.prepare("UPDATE users SET daily_lead_cap = ? WHERE id = ?").run(backup.dailyLeadCap, userId);
    }
  });

  try {
    importTx();
    res.json({ ok: true, stats });
  } catch (err) {
    console.error("Backup import failed:", err);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
