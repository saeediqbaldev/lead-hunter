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
};
