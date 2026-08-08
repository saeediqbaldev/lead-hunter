const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/notifications/feed?limit=&unread=true
// Merges tracked_notifications (email open/click alerts, every platform)
// with app_notifications (campaign events and anything else general-
// purpose) into one combined, time-sorted feed - this is what powers the
// header bell icon, which shouldn't require checking multiple separate
// pages to see everything that needs attention.
//
// tracked_notifications is also what the Alerts page reads from
// independently, so "clearing" one from this feed must not delete the
// underlying row - is_dismissed_from_feed hides it here while leaving it
// fully intact for Alerts. app_notifications isn't shown anywhere else,
// so those are safe to hard-delete.
router.get("/feed", (req, res) => {
  const userId = req.session.userId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const unreadOnly = req.query.unread === "true";

  try {
    const trackerRows = db
      .prepare(
        `SELECT n.id, 'tracker' AS source, n.type, e.subject AS title, n.message, n.is_read, n.created_at,
                ('lead-email:' || n.email_id) AS link
         FROM tracked_notifications n JOIN tracked_emails e ON e.id = n.email_id
         WHERE n.user_id = ? AND n.is_dismissed_from_feed = 0 ${unreadOnly ? "AND n.is_read = 0" : ""}
         ORDER BY n.created_at DESC LIMIT ?`
      )
      .all(userId, limit);

    const appRows = db
      .prepare(
        `SELECT id, 'app' AS source, type, title, message, is_read, created_at, link
         FROM app_notifications
         WHERE user_id = ? ${unreadOnly ? "AND is_read = 0" : ""}
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, limit);

    const merged = [...trackerRows, ...appRows]
      .map((r) => ({ ...r, is_read: !!r.is_read }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);

    res.json({ notifications: merged });
  } catch (err) {
    console.error("Failed to load notification feed:", err);
    res.status(500).json({ error: "Failed to load notification feed" });
  }
});

router.get("/feed/unread-count", (req, res) => {
  const userId = req.session.userId;
  try {
    const trackerCount = db.prepare("SELECT COUNT(*) AS c FROM tracked_notifications WHERE user_id = ? AND is_read = 0 AND is_dismissed_from_feed = 0").get(userId).c;
    const appCount = db.prepare("SELECT COUNT(*) AS c FROM app_notifications WHERE user_id = ? AND is_read = 0").get(userId).c;
    res.json({ count: trackerCount + appCount });
  } catch (err) {
    console.error("Failed to count unread notifications:", err);
    res.status(500).json({ error: "Failed to count unread notifications" });
  }
});

// POST /api/notifications/feed/:source/:id/read { source: 'tracker'|'app' }
router.post("/feed/:source/:id/read", (req, res) => {
  const { source, id } = req.params;
  const table = source === "app" ? "app_notifications" : "tracked_notifications";
  try {
    db.prepare(`UPDATE ${table} SET is_read = 1 WHERE id = ? AND user_id = ?`).run(id, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

router.post("/feed/mark-all-read", (req, res) => {
  const userId = req.session.userId;
  try {
    db.prepare("UPDATE tracked_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(userId);
    db.prepare("UPDATE app_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// DELETE /api/notifications/feed/:source/:id { source: 'tracker'|'app' }
// "tracker" notifications are dismissed (hidden from this feed only),
// never deleted, since the underlying row is shared with the Alerts page.
router.delete("/feed/:source/:id", (req, res) => {
  const { source, id } = req.params;
  try {
    if (source === "app") {
      const owned = db.prepare("SELECT id FROM app_notifications WHERE id = ? AND user_id = ?").get(id, req.session.userId);
      if (!owned) return res.status(404).json({ error: "Not found" });
      db.prepare("DELETE FROM app_notifications WHERE id = ?").run(id);
    } else {
      const owned = db.prepare("SELECT id FROM tracked_notifications WHERE id = ? AND user_id = ?").get(id, req.session.userId);
      if (!owned) return res.status(404).json({ error: "Not found" });
      db.prepare("UPDATE tracked_notifications SET is_dismissed_from_feed = 1 WHERE id = ?").run(id);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// POST /api/notifications/feed/clear - clears every notification from the
// header feed for this user. Tracker-sourced items are dismissed from
// the feed only (the Alerts page still shows them); app-sourced campaign
// events are hard-deleted since nothing else depends on them.
router.post("/feed/clear", (req, res) => {
  const userId = req.session.userId;
  try {
    const a = db.prepare("UPDATE tracked_notifications SET is_dismissed_from_feed = 1 WHERE user_id = ? AND is_dismissed_from_feed = 0").run(userId).changes;
    const b = db.prepare("DELETE FROM app_notifications WHERE user_id = ?").run(userId).changes;
    res.json({ ok: true, cleared: a + b });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

module.exports = router;
