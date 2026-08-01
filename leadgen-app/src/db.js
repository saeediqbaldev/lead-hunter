const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "leadgen.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

// ---------- Step 1: base schema (safe no-op on existing tables) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  theme TEXT, -- JSON: { mode: 'light'|'dark', colors: { ...overrides } }
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS niches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS catch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  niche_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  keyword TEXT,
  location TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  search_date TEXT NOT NULL,
  leads_pulled INTEGER NOT NULL,
  keyword TEXT,
  location TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tracks businesses ever pulled per (user, niche, normalized location) so a
-- repeat hunt for the same niche+city can skip what's already been surfaced
-- and dig for new ones instead. See src/routes/search.js for how this is used.
CREATE TABLE IF NOT EXISTS seen_places (
  user_id INTEGER NOT NULL,
  niche_id INTEGER NOT NULL,
  location_key TEXT NOT NULL,
  place_id TEXT NOT NULL,
  first_seen_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, niche_id, location_key, place_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  label TEXT NOT NULL,
  key_value TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  requests_made INTEGER DEFAULT 0,
  leads_caught INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- Step 2: additive migrations for pre-existing installs ----------
// These must run BEFORE step 3 (ownership backfill), since that step writes
// to these columns and they may not exist yet on an older database file.

// niches.name used to be globally UNIQUE; now it must be unique per-user
// instead. SQLite can't ALTER a UNIQUE constraint in place, so rebuild.
{
  const nicheTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='niches'").get().sql;
  if (!nicheTableSql.includes("UNIQUE(user_id, name)")) {
    db.exec("ALTER TABLE niches RENAME TO niches_old");
    db.exec(`
      CREATE TABLE niches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, name)
      );
    `);
    const oldCols = db.prepare("PRAGMA table_info(niches_old)").all().map((c) => c.name);
    const hasUserIdAlready = oldCols.includes("user_id");
    if (hasUserIdAlready) {
      db.exec("INSERT INTO niches (id, user_id, name, created_at) SELECT id, user_id, name, created_at FROM niches_old");
    } else {
      db.exec("INSERT INTO niches (id, name, created_at) SELECT id, name, created_at FROM niches_old");
    }
    db.exec("DROP TABLE niches_old");
    console.log("[migration] niches.name uniqueness is now scoped per-user instead of global.");
  }
}

{
  const apiKeyCols = db.prepare("PRAGMA table_info(api_keys)").all().map((c) => c.name);
  if (!apiKeyCols.includes("user_id")) db.exec("ALTER TABLE api_keys ADD COLUMN user_id INTEGER");
  if (!apiKeyCols.includes("is_active")) db.exec("ALTER TABLE api_keys ADD COLUMN is_active INTEGER DEFAULT 0");
  if (!apiKeyCols.includes("requests_made")) db.exec("ALTER TABLE api_keys ADD COLUMN requests_made INTEGER DEFAULT 0");
  if (!apiKeyCols.includes("leads_caught")) db.exec("ALTER TABLE api_keys ADD COLUMN leads_caught INTEGER DEFAULT 0");
  // "provider" distinguishes Google Places keys (used for hunting) from
  // Gemini keys (used for business analysis + outreach content) - existing
  // rows predate this column and are all Google Places keys.
  if (!apiKeyCols.includes("provider")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN provider TEXT DEFAULT 'google_places'");
    db.exec("UPDATE api_keys SET provider = 'google_places' WHERE provider IS NULL");
  }
}

{
  const searchLogCols = db.prepare("PRAGMA table_info(search_log)").all().map((c) => c.name);
  if (!searchLogCols.includes("user_id")) db.exec("ALTER TABLE search_log ADD COLUMN user_id INTEGER");
}

// ---------- Step 3: migrate the old hardcoded single login into a real user ----------
// Earlier versions had one hardcoded admin (Saeeddev / Saeed@@2026&&) and no
// concept of ownership on niches/api_keys/search_log. This creates a real
// `users` row for that account (same credentials, nobody gets locked out)
// and assigns every existing un-owned row to it.
{
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (userCount === 0) {
    const hash = bcrypt.hashSync("Saeed@@2026&&", 10);
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run("Saeeddev", hash);
    const adminId = info.lastInsertRowid;

    db.prepare("UPDATE niches SET user_id = ? WHERE user_id IS NULL").run(adminId);
    db.prepare("UPDATE api_keys SET user_id = ? WHERE user_id IS NULL").run(adminId);
    db.prepare("UPDATE search_log SET user_id = ? WHERE user_id IS NULL").run(adminId);

    // Whichever key was globally "active" before becomes this admin's active key.
    const activeIdSetting = db.prepare("SELECT value FROM settings WHERE key = 'active_api_key_id'").get();
    if (activeIdSetting && activeIdSetting.value) {
      db.prepare("UPDATE api_keys SET is_active = 1 WHERE id = ?").run(Number(activeIdSetting.value));
    }

    console.log('[migration] Created admin account "Saeeddev" (same password as before) and assigned all existing data to it.');
  }
}

// One-time migration: earlier versions of Settings stored a single key under
// settings.google_places_api_key (from before api_keys existed at all). Move
// it into the multi-key list so nothing anyone already saved gets lost.
{
  const keyCount = db.prepare("SELECT COUNT(*) AS c FROM api_keys").get().c;
  if (keyCount === 0) {
    const legacy = db.prepare("SELECT value FROM settings WHERE key = ?").get("google_places_api_key");
    const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
    if (legacy && legacy.value && adminRow) {
      db.prepare("INSERT INTO api_keys (user_id, label, key_value, is_active) VALUES (?, 'Default', ?, 1)").run(
        adminRow.id,
        legacy.value
      );
      console.log('[migration] Moved the existing Google API key into the new multi-key list as "Default".');
    }
  }
}

// ---------- Step 4: leads table (catch-log schema + socials column) ----------
const leadsTableExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'")
  .get();

if (!leadsTableExists) {
  db.exec(`
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catch_log_id INTEGER NOT NULL,
      place_id TEXT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      website TEXT,
      rating REAL,
      review_count INTEGER,
      business_status TEXT,
      needs TEXT,
      socials TEXT,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(catch_log_id, place_id)
    );
  `);
} else {
  const cols = db.prepare("PRAGMA table_info(leads)").all();
  const hasCatchLogId = cols.some((c) => c.name === "catch_log_id");

  if (!hasCatchLogId) {
    console.log("[migration] Old leads schema detected. Migrating into Niches/Catch Logs...");

    const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
    let defaultNiche = db.prepare("SELECT * FROM niches WHERE name = ? AND user_id = ?").get("Uncategorized", adminRow.id);
    if (!defaultNiche) {
      const info = db.prepare("INSERT INTO niches (user_id, name) VALUES (?, ?)").run(adminRow.id, "Uncategorized");
      defaultNiche = { id: info.lastInsertRowid };
    }

    const oldLeads = db.prepare("SELECT * FROM leads").all();
    const groupToCatchLogId = new Map();

    function getOrCreateCatchLog(keyword, location) {
      const key = `${keyword || ""}::${location || ""}`;
      if (groupToCatchLogId.has(key)) return groupToCatchLogId.get(key);
      const logName =
        keyword || location
          ? `${keyword || "search"} in ${location || "unknown"} (imported)`
          : "Imported leads";
      const info = db
        .prepare("INSERT INTO catch_logs (niche_id, name, keyword, location) VALUES (?, ?, ?, ?)")
        .run(defaultNiche.id, logName, keyword || null, location || null);
      groupToCatchLogId.set(key, info.lastInsertRowid);
      return info.lastInsertRowid;
    }

    db.exec("ALTER TABLE leads RENAME TO leads_old");
    db.exec(`
      CREATE TABLE leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catch_log_id INTEGER NOT NULL,
        place_id TEXT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        website TEXT,
        rating REAL,
        review_count INTEGER,
        business_status TEXT,
        needs TEXT,
        socials TEXT,
        status TEXT DEFAULT 'new',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(catch_log_id, place_id)
      );
    `);

    const insertMigrated = db.prepare(`
      INSERT INTO leads (catch_log_id, place_id, name, address, phone, website, rating,
                          review_count, business_status, needs, status, notes, created_at)
      VALUES (@catch_log_id, @place_id, @name, @address, @phone, @website, @rating,
              @review_count, @business_status, @needs, @status, @notes, @created_at)
    `);

    const migrate = db.transaction((rows) => {
      for (const row of rows) {
        const catchLogId = getOrCreateCatchLog(row.search_keyword, row.search_location);
        insertMigrated.run({
          catch_log_id: catchLogId,
          place_id: row.place_id,
          name: row.name,
          address: row.address,
          phone: row.phone,
          website: row.website,
          rating: row.rating,
          review_count: row.review_count,
          business_status: row.business_status,
          needs: row.needs,
          status: row.status,
          notes: row.notes,
          created_at: row.created_at,
        });
      }
    });
    migrate(oldLeads);

    db.exec("DROP TABLE leads_old");
    console.log(`[migration] Done. ${oldLeads.length} existing leads moved under "Uncategorized".`);
  }

  const currentCols = db.prepare("PRAGMA table_info(leads)").all();
  if (!currentCols.some((c) => c.name === "socials")) {
    db.exec("ALTER TABLE leads ADD COLUMN socials TEXT");
    console.log('[migration] Added "socials" column to leads.');
  }
}

// ---------- Per-user daily lead cap (default 300, editable in Settings) ----------
{
  const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!userCols.includes("daily_lead_cap")) {
    db.exec("ALTER TABLE users ADD COLUMN daily_lead_cap INTEGER DEFAULT 300");
    console.log('[migration] Added "daily_lead_cap" column to users (default 300).');
  }
}

// ---------- One catch log per (niche, city): merge any existing duplicates ----------
// Before this version, every hunt created a brand new catch log even for a
// niche+city you'd already searched before. Merge any existing duplicates
// into a single canonical catch log per (niche_id, normalized location) so
// old data matches the new "hunts append instead of duplicating" behavior.
{
  function normLoc(loc) {
    return (loc || "").trim().toLowerCase().replace(/[,\s]+/g, " ");
  }

  const allLogs = db
    .prepare("SELECT * FROM catch_logs WHERE location IS NOT NULL AND location != ''")
    .all();
  const groups = new Map(); // "nicheId::normalizedLocation" -> [logs...]
  for (const log of allLogs) {
    const key = `${log.niche_id}::${normLoc(log.location)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  }

  let mergedGroups = 0;
  const mergeTx = db.transaction(() => {
    for (const logs of groups.values()) {
      if (logs.length < 2) continue; // nothing to merge

      logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const canonical = logs[0];
      const duplicates = logs.slice(1);

      for (const dup of duplicates) {
        const dupLeads = db.prepare("SELECT * FROM leads WHERE catch_log_id = ?").all(dup.id);
        for (const lead of dupLeads) {
          const clash = lead.place_id
            ? db
                .prepare("SELECT id FROM leads WHERE catch_log_id = ? AND place_id = ?")
                .get(canonical.id, lead.place_id)
            : null;
          if (clash) {
            // Already have this exact business in the canonical log - drop the duplicate row
            db.prepare("DELETE FROM leads WHERE id = ?").run(lead.id);
          } else {
            db.prepare("UPDATE leads SET catch_log_id = ? WHERE id = ?").run(canonical.id, lead.id);
          }
        }
        db.prepare("DELETE FROM catch_logs WHERE id = ?").run(dup.id);
      }
      mergedGroups++;
    }
  });
  mergeTx();

  if (mergedGroups > 0) {
    console.log(`[migration] Merged duplicate catch logs for ${mergedGroups} niche+city combo(s) into one each.`);
  }
}

// ---------- Daily-granularity API key usage (Reports page needs "today's
// usage" specifically, not just the all-time cumulative totals already on
// api_keys) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS api_key_daily_usage (
  api_key_id INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  requests_made INTEGER DEFAULT 0,
  leads_caught INTEGER DEFAULT 0,
  PRIMARY KEY (api_key_id, usage_date)
);
`);

{
  const leadCols = db.prepare("PRAGMA table_info(leads)").all().map((c) => c.name);
  if (!leadCols.includes("pinned")) db.exec("ALTER TABLE leads ADD COLUMN pinned INTEGER DEFAULT 0");
}

// ---------- Business deep-analysis (Reach Out "Inspect" feature) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS business_analysis (
  lead_id INTEGER PRIMARY KEY,
  status TEXT DEFAULT 'pending',
  current_step TEXT,
  overall_score INTEGER,
  website_score INTEGER,
  gmb_score INTEGER,
  social_score INTEGER,
  reputation_score INTEGER,
  checklist TEXT,
  strengths TEXT,
  weaknesses TEXT,
  suggested_services TEXT,
  raw_data TEXT,
  error TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

{
  const businessAnalysisCols = db.prepare("PRAGMA table_info(business_analysis)").all().map((c) => c.name);
  if (!businessAnalysisCols.includes("provider")) db.exec("ALTER TABLE business_analysis ADD COLUMN provider TEXT");
}

// ---------- Generated outreach content, per lead per platform ----------
db.exec(`
CREATE TABLE IF NOT EXISTS outreach_content (
  lead_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  tone TEXT,
  content TEXT,
  generated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, platform)
);
`);

{
  const outreachContentCols = db.prepare("PRAGMA table_info(outreach_content)").all().map((c) => c.name);
  if (!outreachContentCols.includes("length")) db.exec("ALTER TABLE outreach_content ADD COLUMN length TEXT");
  if (!outreachContentCols.includes("provider")) db.exec("ALTER TABLE outreach_content ADD COLUMN provider TEXT");
}

// ---------- Async batch content generation job tracking (generates all
// platforms at once in the background, mirroring the Inspect job pattern -
// this is what avoids any single HTTP request needing to stay open long
// enough to hit a reverse-proxy timeout) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS content_generation_jobs (
  lead_id INTEGER PRIMARY KEY,
  status TEXT DEFAULT 'pending',
  current_step TEXT,
  completed_platforms TEXT DEFAULT '[]',
  failed_platforms TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
