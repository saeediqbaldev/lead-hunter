const db = require("./db");

function listKeys(userId) {
  return db
    .prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at ASC, id ASC")
    .all(userId);
}

function getKeyById(userId, id) {
  return db.prepare("SELECT * FROM api_keys WHERE user_id = ? AND id = ?").get(userId, id);
}

function getActiveKey(userId) {
  return db.prepare("SELECT * FROM api_keys WHERE user_id = ? AND is_active = 1").get(userId);
}

function getActiveKeyValue(userId) {
  const row = getActiveKey(userId);
  return row ? row.key_value : null;
}

function setActive(userId, id) {
  const tx = db.transaction(() => {
    db.prepare("UPDATE api_keys SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE api_keys SET is_active = 1 WHERE user_id = ? AND id = ?").run(userId, id);
  });
  tx();
}

function insertKey(userId, label, keyValue) {
  const wasEmpty = db.prepare("SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ?").get(userId).c === 0;
  const info = db
    .prepare("INSERT INTO api_keys (user_id, label, key_value, is_active) VALUES (?, ?, ?, 0)")
    .run(userId, label, keyValue);
  // First key this user ever saves becomes active automatically.
  if (wasEmpty) setActive(userId, info.lastInsertRowid);
  return getKeyById(userId, info.lastInsertRowid);
}

function deleteKey(userId, id) {
  db.prepare("DELETE FROM api_keys WHERE user_id = ? AND id = ?").run(userId, id);
}

// Called after every Places API call this key was used for, so usage is
// visible per-key in Settings ("how much has each key actually been used").
function recordUsage(userId, keyId, { requests = 0, leadsCaught = 0 } = {}) {
  if (!keyId) return;
  db.prepare(
    "UPDATE api_keys SET requests_made = requests_made + ?, leads_caught = leads_caught + ? WHERE user_id = ? AND id = ?"
  ).run(requests, leadsCaught, userId, keyId);

  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO api_key_daily_usage (api_key_id, usage_date, requests_made, leads_caught) VALUES (?, ?, ?, ?)
     ON CONFLICT(api_key_id, usage_date) DO UPDATE SET
       requests_made = requests_made + excluded.requests_made,
       leads_caught = leads_caught + excluded.leads_caught`
  ).run(keyId, today, requests, leadsCaught);
}

function todaysUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT k.id, k.label, k.is_active,
              COALESCE(d.requests_made, 0) AS requests_made,
              COALESCE(d.leads_caught, 0) AS leads_caught
       FROM api_keys k
       LEFT JOIN api_key_daily_usage d ON d.api_key_id = k.id AND d.usage_date = ?
       WHERE k.user_id = ?
       ORDER BY k.created_at ASC`
    )
    .all(today, userId);
}

module.exports = {
  listKeys,
  getKeyById,
  getActiveKey,
  getActiveKeyValue,
  setActive,
  insertKey,
  deleteKey,
  recordUsage,
  todaysUsage,
};
