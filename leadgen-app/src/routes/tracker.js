const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const db = require("../db");
const { setSetting } = require("../settingsStore");
const { sendTestEmail } = require("../trackerNotify");

const router = express.Router();

// ==================== Emails ====================
// GET /api/tracker/emails?status=&recipient=&search=&from=&to=&limit=&offset=
router.get("/emails", (req, res) => {
  const { status, recipient, search, from, to, provider } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const userId = req.session.userId;

  const clauses = ["user_id = ?"];
  const values = [userId];
  if (provider) {
    clauses.push("provider = ?");
    values.push(provider);
  }

  if (status === "opened") {
    clauses.push(`status IN ('opened', 'clicked')`);
  } else if (status) {
    clauses.push(`status = ?`);
    values.push(status);
  }
  if (recipient) {
    clauses.push(`recipients LIKE ?`);
    values.push(`%${recipient}%`);
  }
  if (search) {
    clauses.push(`subject LIKE ?`);
    values.push(`%${search}%`);
  }
  if (from) {
    clauses.push(`created_at >= ?`);
    values.push(from);
  }
  if (to) {
    clauses.push(`created_at <= ?`);
    values.push(to);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;

  try {
    const total = db.prepare(`SELECT COUNT(*) AS c FROM tracked_emails ${where}`).get(...values).c;
    const rows = db
      .prepare(
        `SELECT id, subject, recipients, sender, provider, created_at, status,
                open_count, click_count, first_opened_at, last_opened_at, replied_at, delivery_failed_at
         FROM tracked_emails ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset)
      .map((r) => ({ ...r, recipients: JSON.parse(r.recipients || "[]") }));

    res.json({ emails: rows, total, limit, offset });
  } catch (err) {
    console.error("Failed to list tracked emails:", err);
    res.status(500).json({ error: "Failed to list emails" });
  }
});

// GET /api/tracker/emails/:id
router.get("/emails/:id", (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  try {
    const email = db.prepare("SELECT * FROM tracked_emails WHERE id = ? AND user_id = ?").get(id, userId);
    if (!email) return res.status(404).json({ error: "Not found" });

    const opens = db.prepare("SELECT id, opened_at, ip, user_agent, browser, os, device, city, country FROM tracked_opens WHERE email_id = ? ORDER BY opened_at DESC").all(id);
    const clicks = db.prepare("SELECT id, url, clicked_at, ip, user_agent, browser, os, device, city, country FROM tracked_clicks WHERE email_id = ? ORDER BY clicked_at DESC").all(id);

    res.json({ email: { ...email, recipients: JSON.parse(email.recipients || "[]") }, opens, clicks });
  } catch (err) {
    console.error("Failed to load email detail:", err);
    res.status(500).json({ error: "Failed to load email detail" });
  }
});

// GET /api/tracker/emails/:id/thread - the full sequence for this email's
// lead within its campaign (original + every follow-up + reply status),
// not just the single touch this specific tracked email represents.
// Powers the "show the first email, followups and reply" view from both
// the Alerts dialog and the campaign dashboard.
router.get("/emails/:id/thread", (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;

  try {
    const email = db.prepare("SELECT * FROM tracked_emails WHERE id = ? AND user_id = ?").get(id, userId);
    if (!email) return res.status(404).json({ error: "Not found" });

    const campaignLead = db.prepare("SELECT campaign_id, lead_id FROM email_campaign_leads WHERE tracked_email_id = ?").get(id);
    if (!campaignLead) {
      // Not part of a campaign (e.g. sent manually via the extension) -
      // no follow-up sequence exists, so the "thread" is just this one email.
      return res.json({
        thread: [{ touchNumber: 1, status: email.status, subject: email.subject, bodyHtml: email.body_html, sentAt: email.created_at, repliedAt: email.replied_at }],
        nextFollowUpAt: null,
      });
    }

    const campaign = db.prepare("SELECT followup_enabled, followup_max_count, followup_wait_days FROM email_campaigns WHERE id = ?").get(campaignLead.campaign_id);
    const touches = db
      .prepare(
        `SELECT ecl.touch_number, ecl.status, ecl.sent_at, ecl.replied_at, te.subject, te.body_html
         FROM email_campaign_leads ecl
         LEFT JOIN tracked_emails te ON te.id = ecl.tracked_email_id
         WHERE ecl.campaign_id = ? AND ecl.lead_id = ?
         ORDER BY ecl.touch_number ASC`
      )
      .all(campaignLead.campaign_id, campaignLead.lead_id);

    const thread = touches.map((t) => ({
      touchNumber: t.touch_number,
      status: t.status,
      subject: t.subject,
      bodyHtml: t.body_html,
      sentAt: t.sent_at,
      repliedAt: t.replied_at,
    }));

    // If the latest touch is sent, nothing has replied yet, follow-ups are
    // enabled, and there's room for another touch, the next one is
    // expected at sent_at + wait_days - computed for display only, no DB
    // row exists for it yet (the scheduler only creates one once it's
    // actually due).
    let nextFollowUpAt = null;
    const latest = thread[thread.length - 1];
    const anyReplied = thread.some((t) => t.repliedAt);
    if (campaign?.followup_enabled && !anyReplied && latest?.status === "sent" && latest.touchNumber < campaign.followup_max_count + 1) {
      const sentDate = new Date(latest.sentAt.replace(" ", "T") + "Z");
      sentDate.setDate(sentDate.getDate() + campaign.followup_wait_days);
      nextFollowUpAt = sentDate.toISOString();
    }

    res.json({ thread, nextFollowUpAt });
  } catch (err) {
    console.error("Failed to load email thread:", err);
    res.status(500).json({ error: "Failed to load email thread" });
  }
});

// PATCH /api/tracker/emails/:id { notes }
router.patch("/emails/:id", (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};
  const userId = req.session.userId;

  if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });

  try {
    const info = db.prepare("UPDATE tracked_emails SET notes = ? WHERE id = ? AND user_id = ?").run(notes, id, userId);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    const email = db.prepare("SELECT * FROM tracked_emails WHERE id = ?").get(id);
    res.json({ email: { ...email, recipients: JSON.parse(email.recipients || "[]") } });
  } catch (err) {
    console.error("Failed to update email:", err);
    res.status(500).json({ error: "Failed to update email" });
  }
});

// POST /api/tracker/emails/:id/clear-reply - clears a mistakenly-marked
// reply (e.g. an out-of-office that slipped through before auto-reply
// filtering existed). Also clears the linked campaign lead's replied_at,
// so a false positive doesn't permanently block a legitimate follow-up.
router.post("/emails/:id/clear-reply", (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  try {
    const info = db.prepare("UPDATE tracked_emails SET replied_at = NULL WHERE id = ? AND user_id = ?").run(id, userId);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    db.prepare("UPDATE email_campaign_leads SET replied_at = NULL WHERE tracked_email_id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to clear reply mark:", err);
    res.status(500).json({ error: "Failed to clear reply mark" });
  }
});

// DELETE /api/tracker/emails/:id
// Deletes a tracked email and everything that actually references it -
// its open/click event log, any notifications generated from it, and
// clears (not deletes) the campaign-lead row's reference to it. This is
// done explicitly rather than relying on the schema's ON DELETE CASCADE
// declarations, because SQLite only enforces foreign keys when
// PRAGMA foreign_keys=ON is set per-connection - this app never sets
// it, so those cascade declarations are inert and a plain DELETE FROM
// tracked_emails alone leaves orphaned rows behind in every one of
// those tables.
function deleteTrackedEmailsCompletely(ids, userId) {
  const placeholders = ids.map(() => "?").join(",");
  const ownedIds = db
    .prepare(`SELECT id FROM tracked_emails WHERE id IN (${placeholders}) AND user_id = ?`)
    .all(...ids, userId)
    .map((r) => r.id);
  if (!ownedIds.length) return 0;

  const ownedPlaceholders = ownedIds.map(() => "?").join(",");
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM tracked_opens WHERE email_id IN (${ownedPlaceholders})`).run(...ownedIds);
    db.prepare(`DELETE FROM tracked_clicks WHERE email_id IN (${ownedPlaceholders})`).run(...ownedIds);
    db.prepare(`DELETE FROM tracked_notifications WHERE email_id IN (${ownedPlaceholders})`).run(...ownedIds);
    // Clear the dangling reference rather than deleting the row itself -
    // it's the campaign's own send/follow-up history, and removing it
    // outright could make the scheduler think this lead was never
    // contacted and send to them again.
    db.prepare(`UPDATE email_campaign_leads SET tracked_email_id = NULL WHERE tracked_email_id IN (${ownedPlaceholders})`).run(...ownedIds);
    const info = db.prepare(`DELETE FROM tracked_emails WHERE id IN (${ownedPlaceholders})`).run(...ownedIds);
    return info.changes;
  });
  return run();
}

router.delete("/emails/:id", (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  try {
    const deleted = deleteTrackedEmailsCompletely([id], userId);
    if (deleted === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, id });
  } catch (err) {
    console.error("Failed to delete email:", err);
    res.status(500).json({ error: "Failed to delete email" });
  }
});

// POST /api/tracker/emails/bulk-delete { ids: [...] }
router.post("/emails/bulk-delete", (req, res) => {
  const { ids } = req.body || {};
  const userId = req.session.userId;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" });

  try {
    const deleted = deleteTrackedEmailsCompletely(ids, userId);
    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("Failed to bulk delete emails:", err);
    res.status(500).json({ error: "Failed to bulk delete emails" });
  }
});

// ==================== Notifications ====================
// GET /api/tracker/notifications?unread=true&type=open
router.get("/notifications", (req, res) => {
  const { unread, type, provider, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const userId = req.session.userId;

  const clauses = ["n.user_id = ?"];
  const values = [userId];
  if (unread === "true") clauses.push("n.is_read = 0");
  if (type === "open" || type === "click") {
    clauses.push("n.type = ?");
    values.push(type);
  }
  if (provider) {
    clauses.push("e.provider = ?");
    values.push(provider);
  }
  if (search) {
    clauses.push("(n.message LIKE ? OR e.subject LIKE ? OR e.recipients LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  try {
    const rows = db
      .prepare(
        `SELECT n.id, n.email_id, n.type, n.url, n.message, n.is_read, n.created_at,
                e.subject, e.recipients, e.provider
         FROM tracked_notifications n JOIN tracked_emails e ON e.id = n.email_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY n.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset)
      .map((r) => ({ ...r, recipients: JSON.parse(r.recipients || "[]"), is_read: !!r.is_read }));
    res.json({ notifications: rows });
  } catch (err) {
    console.error("Failed to list notifications:", err);
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

// GET /api/tracker/notifications/unread-count?provider= - provider is
// optional; omitted for the top-level Contacted sidebar badge (combined
// total across every platform), included for a specific platform's own
// Alerts sub-badge.
router.get("/notifications/unread-count", (req, res) => {
  try {
    const { provider } = req.query;
    const row = provider
      ? db
          .prepare(
            `SELECT COUNT(*) AS count FROM tracked_notifications n JOIN tracked_emails e ON e.id = n.email_id
             WHERE n.is_read = 0 AND n.user_id = ? AND e.provider = ?`
          )
          .get(req.session.userId, provider)
      : db.prepare("SELECT COUNT(*) AS count FROM tracked_notifications WHERE is_read = 0 AND user_id = ?").get(req.session.userId);
    res.json({ count: row.count });
  } catch (err) {
    console.error("Failed to count unread notifications:", err);
    res.status(500).json({ error: "Failed to count unread notifications" });
  }
});

// PATCH /api/tracker/notifications/:id { is_read }
router.patch("/notifications/:id", (req, res) => {
  const { id } = req.params;
  const { is_read } = req.body || {};
  if (typeof is_read !== "boolean") return res.status(400).json({ error: "is_read must be a boolean" });
  try {
    const info = db.prepare("UPDATE tracked_notifications SET is_read = ? WHERE id = ? AND user_id = ?").run(is_read ? 1 : 0, id, req.session.userId);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to update notification:", err);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

// POST /api/tracker/notifications/mark-all-read { provider? } - marks
// everything read if no provider given, or just that platform's if given
router.post("/notifications/mark-all-read", (req, res) => {
  try {
    const { provider } = req.body || {};
    if (provider) {
      db.prepare(
        `UPDATE tracked_notifications SET is_read = 1
         WHERE is_read = 0 AND user_id = ? AND email_id IN (SELECT id FROM tracked_emails WHERE provider = ?)`
      ).run(req.session.userId, provider);
    } else {
      db.prepare("UPDATE tracked_notifications SET is_read = 1 WHERE is_read = 0 AND user_id = ?").run(req.session.userId);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to mark all notifications read:", err);
    res.status(500).json({ error: "Failed to mark all notifications read" });
  }
});

// DELETE /api/tracker/notifications/:id
router.delete("/notifications/:id", (req, res) => {
  try {
    const info = db.prepare("DELETE FROM tracked_notifications WHERE id = ? AND user_id = ?").run(req.params.id, req.session.userId);
    if (info.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete notification:", err);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// POST /api/tracker/notifications/bulk-delete { ids: [...] }
router.post("/notifications/bulk-delete", (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" });
  try {
    const placeholders = ids.map(() => "?").join(",");
    const info = db.prepare(`DELETE FROM tracked_notifications WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.session.userId);
    res.json({ ok: true, deleted: info.changes });
  } catch (err) {
    console.error("Failed to bulk delete notifications:", err);
    res.status(500).json({ error: "Failed to bulk delete notifications" });
  }
});

// POST /api/tracker/notifications/clear?provider= - clears every alert
// for this user (optionally scoped to one platform). Alerts is the
// source-of-truth page for this data (unlike the header feed, which only
// dismisses items from its own view without touching the underlying
// record), so this is a genuine, permanent delete.
router.post("/notifications/clear", (req, res) => {
  const { provider } = req.query;
  try {
    let info;
    if (provider) {
      info = db
        .prepare(
          `DELETE FROM tracked_notifications WHERE user_id = ? AND email_id IN (
             SELECT id FROM tracked_emails WHERE user_id = ? AND provider = ?
           )`
        )
        .run(req.session.userId, req.session.userId, provider);
    } else {
      info = db.prepare("DELETE FROM tracked_notifications WHERE user_id = ?").run(req.session.userId);
    }
    res.json({ ok: true, deleted: info.changes });
  } catch (err) {
    console.error("Failed to clear notifications:", err);
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

// ==================== Settings ====================
// GET /api/tracker/settings - never returns the raw smtp password, only
// whether one is set, so it can't leak back to the browser on page load.
router.get("/settings", (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT tracker_refresh_interval AS refresh_interval_seconds,
                tracker_notify_email_enabled AS notify_email_enabled,
                tracker_notify_email_to AS notify_email_to,
                tracker_smtp_host AS smtp_host, tracker_smtp_port AS smtp_port,
                tracker_smtp_user AS smtp_user, tracker_smtp_pass AS smtp_pass,
                tracker_smtp_from AS smtp_from
         FROM users WHERE id = ?`
      )
      .get(req.session.userId);
    const { smtp_pass, ...rest } = row || {};
    res.json({ settings: { ...rest, notify_email_enabled: !!rest.notify_email_enabled, smtp_pass_set: !!smtp_pass } });
  } catch (err) {
    console.error("Failed to load tracker settings:", err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// PUT /api/tracker/settings - smtp_pass omitted or "" leaves the current
// password untouched (e.g. just flipping the enabled checkbox).
router.put("/settings", (req, res) => {
  const { refresh_interval_seconds, notify_email_enabled, notify_email_to, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body || {};
  const userId = req.session.userId;

  if (refresh_interval_seconds !== undefined && (!Number.isInteger(refresh_interval_seconds) || refresh_interval_seconds < 0 || refresh_interval_seconds > 43200)) {
    return res.status(400).json({ error: "refresh_interval_seconds must be 0-43200" });
  }
  if (smtp_port !== undefined && smtp_port !== null && (!Number.isInteger(smtp_port) || smtp_port < 1 || smtp_port > 65535)) {
    return res.status(400).json({ error: "smtp_port must be a valid port number" });
  }

  try {
    const current = db.prepare("SELECT tracker_smtp_pass FROM users WHERE id = ?").get(userId);
    db.prepare(
      `UPDATE users SET
        tracker_refresh_interval = COALESCE(?, tracker_refresh_interval),
        tracker_notify_email_enabled = COALESCE(?, tracker_notify_email_enabled),
        tracker_notify_email_to = COALESCE(?, tracker_notify_email_to),
        tracker_smtp_host = COALESCE(?, tracker_smtp_host),
        tracker_smtp_port = COALESCE(?, tracker_smtp_port),
        tracker_smtp_user = COALESCE(?, tracker_smtp_user),
        tracker_smtp_pass = ?,
        tracker_smtp_from = COALESCE(?, tracker_smtp_from)
       WHERE id = ?`
    ).run(
      refresh_interval_seconds ?? null,
      notify_email_enabled === undefined ? null : notify_email_enabled ? 1 : 0,
      notify_email_to ?? null,
      smtp_host ?? null,
      smtp_port ?? null,
      smtp_user ?? null,
      smtp_pass ? smtp_pass : current.tracker_smtp_pass,
      smtp_from ?? null,
      userId
    );

    const row = db
      .prepare(
        `SELECT tracker_refresh_interval AS refresh_interval_seconds, tracker_notify_email_enabled AS notify_email_enabled,
                tracker_notify_email_to AS notify_email_to, tracker_smtp_host AS smtp_host, tracker_smtp_port AS smtp_port,
                tracker_smtp_user AS smtp_user, tracker_smtp_pass AS smtp_pass, tracker_smtp_from AS smtp_from
         FROM users WHERE id = ?`
      )
      .get(userId);
    const { smtp_pass: hidden, ...rest } = row;
    res.json({ settings: { ...rest, notify_email_enabled: !!rest.notify_email_enabled, smtp_pass_set: !!hidden } });
  } catch (err) {
    console.error("Failed to update tracker settings:", err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// POST /api/tracker/settings/test-email
router.post("/settings/test-email", async (req, res) => {
  try {
    await sendTestEmail(req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/tracker/gmail-settings - Gmail's own SMTP setup, separate from
// Hostinger's since Gmail structurally needs different fields (fixed
// host, requires a Google App Password rather than the account password).
router.get("/gmail-settings", (req, res) => {
  const row = db.prepare("SELECT gmail_smtp_user, gmail_smtp_app_password FROM users WHERE id = ?").get(req.session.userId);
  res.json({ gmailUser: row?.gmail_smtp_user || "", appPasswordSet: !!row?.gmail_smtp_app_password });
});

router.put("/gmail-settings", (req, res) => {
  const { gmailUser, appPassword } = req.body || {};
  const current = db.prepare("SELECT gmail_smtp_app_password FROM users WHERE id = ?").get(req.session.userId);
  db.prepare("UPDATE users SET gmail_smtp_user = COALESCE(?, gmail_smtp_user), gmail_smtp_app_password = ? WHERE id = ?").run(
    gmailUser ?? null,
    appPassword ? appPassword : current?.gmail_smtp_app_password,
    req.session.userId
  );
  const row = db.prepare("SELECT gmail_smtp_user, gmail_smtp_app_password FROM users WHERE id = ?").get(req.session.userId);
  res.json({ gmailUser: row.gmail_smtp_user || "", appPasswordSet: !!row.gmail_smtp_app_password });
});

// GET/PUT /api/tracker/bluehost-settings - Bluehost/Titan's own SMTP+IMAP
// setup, entirely separate storage from Hostinger's /settings route -
// both providers need full SMTP+IMAP host/port/user/pass, but sharing
// Hostinger's own columns would mean setting up Bluehost/Titan silently
// overwrites real Hostinger credentials for anyone with both configured.
router.get("/bluehost-settings", (req, res) => {
  const row = db
    .prepare(
      `SELECT bluehost_smtp_host AS smtp_host, bluehost_smtp_port AS smtp_port, bluehost_smtp_user AS smtp_user,
              bluehost_smtp_pass AS smtp_pass, bluehost_smtp_from AS smtp_from,
              bluehost_imap_host AS imap_host, bluehost_imap_port AS imap_port
       FROM users WHERE id = ?`
    )
    .get(req.session.userId);
  const { smtp_pass, ...rest } = row || {};
  res.json({ settings: { ...rest, smtp_pass_set: !!smtp_pass } });
});

router.put("/bluehost-settings", (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, imap_host, imap_port } = req.body || {};
  const userId = req.session.userId;

  if (smtp_port !== undefined && smtp_port !== null && (!Number.isInteger(smtp_port) || smtp_port < 1 || smtp_port > 65535)) {
    return res.status(400).json({ error: "smtp_port must be a valid port number" });
  }
  if (imap_port !== undefined && imap_port !== null && (!Number.isInteger(imap_port) || imap_port < 1 || imap_port > 65535)) {
    return res.status(400).json({ error: "imap_port must be a valid port number" });
  }

  const current = db.prepare("SELECT bluehost_smtp_pass FROM users WHERE id = ?").get(userId);
  db.prepare(
    `UPDATE users SET
      bluehost_smtp_host = COALESCE(?, bluehost_smtp_host),
      bluehost_smtp_port = COALESCE(?, bluehost_smtp_port),
      bluehost_smtp_user = COALESCE(?, bluehost_smtp_user),
      bluehost_smtp_pass = ?,
      bluehost_smtp_from = COALESCE(?, bluehost_smtp_from),
      bluehost_imap_host = COALESCE(?, bluehost_imap_host),
      bluehost_imap_port = COALESCE(?, bluehost_imap_port)
     WHERE id = ?`
  ).run(
    smtp_host ?? null,
    smtp_port ?? null,
    smtp_user ?? null,
    smtp_pass ? smtp_pass : current?.bluehost_smtp_pass,
    smtp_from ?? null,
    imap_host ?? null,
    imap_port ?? null,
    userId
  );

  const row = db
    .prepare(
      `SELECT bluehost_smtp_host AS smtp_host, bluehost_smtp_port AS smtp_port, bluehost_smtp_user AS smtp_user,
              bluehost_smtp_pass AS smtp_pass, bluehost_smtp_from AS smtp_from,
              bluehost_imap_host AS imap_host, bluehost_imap_port AS imap_port
       FROM users WHERE id = ?`
    )
    .get(userId);
  const { smtp_pass: pw, ...rest } = row;
  res.json({ settings: { ...rest, smtp_pass_set: !!pw } });
});

// ==================== Analytics ====================
// range -> { sqliteModifier: fed to datetime('now', modifier), bucketFmt: strftime format for the timeseries bucket }
const RANGE_TO_SQL = {
  "1d": { modifier: "-1 day", bucketFmt: "%Y-%m-%d %H:00" },
  "7d": { modifier: "-7 days", bucketFmt: "%Y-%m-%d" },
  "30d": { modifier: "-30 days", bucketFmt: "%Y-%m-%d" },
  "90d": { modifier: "-90 days", bucketFmt: "%Y-%m-%d" },
  "1y": { modifier: "-1 year", bucketFmt: "%Y-%m" },
};

// GET /api/tracker/analytics?range=1d|7d|30d|90d|1y&provider=
router.get("/analytics", (req, res) => {
  const range = RANGE_TO_SQL[req.query.range] ? req.query.range : "7d";
  const { modifier, bucketFmt } = RANGE_TO_SQL[range];
  const userId = req.session.userId;
  const { provider } = req.query;
  const providerClause = provider ? "AND e.provider = ?" : "";
  const providerArgs = provider ? [provider] : [];

  try {
    const since = db.prepare(`SELECT datetime('now', ?) AS since`).get(modifier).since;

    const sent = db
      .prepare(`SELECT COUNT(*) AS c FROM tracked_emails e WHERE created_at >= ? AND user_id = ? AND delivery_failed_at IS NULL ${providerClause}`)
      .get(since, userId, ...providerArgs).c;
    const opens = db
      .prepare(`SELECT COUNT(*) AS c FROM tracked_opens o JOIN tracked_emails e ON e.id = o.email_id WHERE o.opened_at >= ? AND e.user_id = ? ${providerClause}`)
      .get(since, userId, ...providerArgs).c;
    const clicks = db
      .prepare(`SELECT COUNT(*) AS c FROM tracked_clicks c JOIN tracked_emails e ON e.id = c.email_id WHERE c.clicked_at >= ? AND e.user_id = ? ${providerClause}`)
      .get(since, userId, ...providerArgs).c;
    const uniqueOpened = db
      .prepare(`SELECT COUNT(DISTINCT o.email_id) AS c FROM tracked_opens o JOIN tracked_emails e ON e.id = o.email_id WHERE o.opened_at >= ? AND e.user_id = ? ${providerClause}`)
      .get(since, userId, ...providerArgs).c;
    const openRate = sent > 0 ? uniqueOpened / sent : 0;

    const timeseries = db
      .prepare(
        `SELECT strftime('${bucketFmt}', ts) AS bucket,
                SUM(CASE WHEN kind = 'open' THEN 1 ELSE 0 END) AS opens,
                SUM(CASE WHEN kind = 'click' THEN 1 ELSE 0 END) AS clicks
         FROM (
           SELECT o.opened_at AS ts, 'open' AS kind FROM tracked_opens o JOIN tracked_emails e ON e.id = o.email_id WHERE o.opened_at >= ? AND e.user_id = ? ${providerClause}
           UNION ALL
           SELECT c.clicked_at AS ts, 'click' AS kind FROM tracked_clicks c JOIN tracked_emails e ON e.id = c.email_id WHERE c.clicked_at >= ? AND e.user_id = ? ${providerClause}
         ) ev GROUP BY 1 ORDER BY 1`
      )
      .all(since, userId, ...providerArgs, since, userId, ...providerArgs);

    const heatmap = db
      .prepare(
        `SELECT CAST(strftime('%w', ts) AS INTEGER) AS day, CAST(strftime('%H', ts) AS INTEGER) AS hour, COUNT(*) AS count
         FROM (
           SELECT o.opened_at AS ts FROM tracked_opens o JOIN tracked_emails e ON e.id = o.email_id WHERE o.opened_at >= ? AND e.user_id = ? ${providerClause}
           UNION ALL
           SELECT c.clicked_at AS ts FROM tracked_clicks c JOIN tracked_emails e ON e.id = c.email_id WHERE c.clicked_at >= ? AND e.user_id = ? ${providerClause}
         ) ev GROUP BY 1, 2`
      )
      .all(since, userId, ...providerArgs, since, userId, ...providerArgs);

    res.json({
      range,
      summary: { sent, opens, clicks, unique_opened: uniqueOpened, open_rate: openRate },
      timeseries,
      heatmap,
    });
  } catch (err) {
    console.error("Failed to load tracker analytics:", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ==================== History (flat open/click event log) ====================
// GET /api/tracker/history?type=open|click&search=&from=&to=&limit=&offset=&provider=
router.get("/history", (req, res) => {
  const { type, search, from, to, provider } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const userId = req.session.userId;

  const clauses = ["e.user_id = ?"];
  const values = [userId];
  if (provider) {
    clauses.push("e.provider = ?");
    values.push(provider);
  }
  if (type === "open" || type === "click") {
    clauses.push("ev.type = ?");
    values.push(type);
  }
  if (search) {
    clauses.push("(e.subject LIKE ? OR e.recipients LIKE ? OR e.body_html LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (from) {
    clauses.push("ev.ts >= ?");
    values.push(from);
  }
  if (to) {
    clauses.push("ev.ts <= ?");
    values.push(to);
  }

  try {
    const total = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT 'open' AS type, id, email_id, opened_at AS ts, ip, user_agent, NULL AS url, browser, os, device, city, country FROM tracked_opens
           UNION ALL
           SELECT 'click' AS type, id, email_id, clicked_at AS ts, ip, user_agent, url, browser, os, device, city, country FROM tracked_clicks
         ) ev
         JOIN tracked_emails e ON e.id = ev.email_id
         WHERE ${clauses.join(" AND ")}`
      )
      .get(...values).c;

    const rows = db
      .prepare(
        `SELECT ev.type, ev.id AS event_id, ev.ts, ev.ip, ev.user_agent, ev.url, ev.browser, ev.os, ev.device, ev.city, ev.country, e.id AS email_id, e.subject, e.recipients, e.provider
         FROM (
           SELECT 'open' AS type, id, email_id, opened_at AS ts, ip, user_agent, NULL AS url, browser, os, device, city, country FROM tracked_opens
           UNION ALL
           SELECT 'click' AS type, id, email_id, clicked_at AS ts, ip, user_agent, url, browser, os, device, city, country FROM tracked_clicks
         ) ev
         JOIN tracked_emails e ON e.id = ev.email_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY ev.ts DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset)
      .map((r) => ({ ...r, recipients: JSON.parse(r.recipients || "[]") }));
    res.json({ events: rows, total, limit, offset });
  } catch (err) {
    console.error("Failed to load tracker history:", err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

// DELETE /api/tracker/history/:type/:id - removes a single open/click
// event. Deliberately scoped by user_id via a join, not just the raw ID,
// so one user can't delete another's event by guessing an ID.
router.delete("/history/:type/:id", (req, res) => {
  const { type, id } = req.params;
  if (type !== "open" && type !== "click") return res.status(400).json({ error: "Invalid event type" });
  const table = type === "open" ? "tracked_opens" : "tracked_clicks";
  const owned = db
    .prepare(`SELECT ${table}.id FROM ${table} JOIN tracked_emails e ON e.id = ${table}.email_id WHERE ${table}.id = ? AND e.user_id = ?`)
    .get(id, req.session.userId);
  if (!owned) return res.status(404).json({ error: "Not found" });
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// POST /api/tracker/history/clear - clears every open/click event for this
// user, optionally scoped to one platform/provider.
router.post("/history/clear", (req, res) => {
  const { provider } = req.body || {};
  const userId = req.session.userId;
  const emailIdsQuery = provider
    ? db.prepare("SELECT id FROM tracked_emails WHERE user_id = ? AND provider = ?").all(userId, provider)
    : db.prepare("SELECT id FROM tracked_emails WHERE user_id = ?").all(userId);
  const emailIds = emailIdsQuery.map((r) => r.id);
  if (!emailIds.length) return res.json({ ok: true, cleared: 0 });
  const placeholders = emailIds.map(() => "?").join(",");
  const opensDeleted = db.prepare(`DELETE FROM tracked_opens WHERE email_id IN (${placeholders})`).run(...emailIds).changes;
  const clicksDeleted = db.prepare(`DELETE FROM tracked_clicks WHERE email_id IN (${placeholders})`).run(...emailIds).changes;
  res.json({ ok: true, cleared: opensDeleted + clicksDeleted });
});

// ==================== Setup (zero-manual-config pieces) ====================
// GET /api/tracker/setup - returns this user's API key, auto-generating one
// on first visit. No .env, no Coolify config - everything needed to wire
// up the extension lives here and in the settings routes above.
router.get("/setup", (req, res) => {
  const userId = req.session.userId;
  let row = db.prepare("SELECT tracker_api_key FROM users WHERE id = ?").get(userId);

  if (!row.tracker_api_key) {
    const key = crypto.randomBytes(32).toString("hex");
    db.prepare("UPDATE users SET tracker_api_key = ? WHERE id = ?").run(key, userId);
    row = { tracker_api_key: key };
  }

  const backendUrl = `${req.protocol}://${req.get("host")}`;
  setSetting("app_base_url", backendUrl);
  res.json({ apiKey: row.tracker_api_key, backendUrl });
});

// POST /api/tracker/setup/rotate-key - invalidates the old key (the
// extension will need re-downloading/reconfiguring after this)
router.post("/setup/rotate-key", (req, res) => {
  const key = crypto.randomBytes(32).toString("hex");
  db.prepare("UPDATE users SET tracker_api_key = ? WHERE id = ?").run(key, req.session.userId);
  res.json({ apiKey: key });
});

// GET /api/tracker/extension-download - streams a ready-to-load Chrome
// extension zip with this user's API key and this app's own domain already
// baked in as the defaults. Load it in chrome://extensions and it just
// works - no options page, no manual typing.
const EXTENSION_TEMPLATE_DIR = path.join(__dirname, "..", "extensionTemplate");
const SUBSTITUTED_FILES = ["background.js", "manifest.json", "popup.js", "options.js"];

router.get("/extension-download", (req, res) => {
  const userId = req.session.userId;
  let row = db.prepare("SELECT tracker_api_key FROM users WHERE id = ?").get(userId);
  if (!row.tracker_api_key) {
    const key = crypto.randomBytes(32).toString("hex");
    db.prepare("UPDATE users SET tracker_api_key = ? WHERE id = ?").run(key, userId);
    row = { tracker_api_key: key };
  }
  const backendUrl = `${req.protocol}://${req.get("host")}`;
  setSetting("app_base_url", backendUrl);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="xeven-leads-contacted-tracker.zip"');

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("Failed to build extension zip:", err);
    if (!res.headersSent) res.status(500).end("Failed to build extension zip");
  });
  archive.pipe(res);

  const entries = fs.readdirSync(EXTENSION_TEMPLATE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      archive.directory(path.join(EXTENSION_TEMPLATE_DIR, entry.name), entry.name);
      continue;
    }
    const fullPath = path.join(EXTENSION_TEMPLATE_DIR, entry.name);
    if (SUBSTITUTED_FILES.includes(entry.name)) {
      let content = fs.readFileSync(fullPath, "utf8");
      content = content.split("__BACKEND_URL__").join(backendUrl).split("__API_KEY__").join(row.tracker_api_key);
      archive.append(content, { name: entry.name });
    } else {
      archive.file(fullPath, { name: entry.name });
    }
  }

  archive.finalize();
});

module.exports = router;
