const { ImapFlow } = require("imapflow");
const db = require("./db");
const { resolveSmtpConfig, HOSTINGER_IMAP_HOST, HOSTINGER_IMAP_PORT } = require("./campaignSender");

// How far back to look on a user's very first check - after that,
// last_reply_check_at takes over and each check only looks at what's
// arrived since the previous one, so this only matters once.
const FIRST_CHECK_LOOKBACK_DAYS = 30;

function extractEmailAddress(fromField) {
  // imapflow's envelope.from is an array of {name, address} objects (one
  // sender - occasionally more for group-sent mail) - address is what
  // matters here, name is just the display name.
  if (!fromField || !fromField.length) return null;
  return (fromField[0].address || "").toLowerCase().trim();
}

// Scans this user's inbox once (not once per recipient - a single
// search-and-fetch pass, then cross-referenced in JS against everything
// they've sent) and marks any tracked_emails row a reply genuinely
// arrived for. This is the ground-truth signal opens/clicks can't
// provide, since both of those can be triggered by mail-client
// prefetching or corporate security scanners with no human involved.
async function checkRepliesForUser(userId) {
  const cfg = resolveSmtpConfig(userId);
  if (!cfg) return { ok: false, error: "IMAP isn't configured for this account" };

  const user = db.prepare("SELECT last_reply_check_at FROM users WHERE id = ?").get(userId);
  const sinceDate = user?.last_reply_check_at
    ? new Date(user.last_reply_check_at.replace(" ", "T") + "Z")
    : new Date(Date.now() - FIRST_CHECK_LOOKBACK_DAYS * 86400000);

  const client = new ImapFlow({
    host: HOSTINGER_IMAP_HOST,
    port: HOSTINGER_IMAP_PORT,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  let repliedAddresses = new Set();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since: sinceDate }, { uid: true });
      if (Array.isArray(uids) && uids.length) {
        for await (const message of client.fetch(uids, { envelope: true }, { uid: true })) {
          const address = extractEmailAddress(message.envelope?.from);
          if (address) repliedAddresses.add(address);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await client.logout().catch(() => {});
  }

  if (repliedAddresses.size === 0) {
    db.prepare("UPDATE users SET last_reply_check_at = datetime('now') WHERE id = ?").run(userId);
    return { ok: true, newReplies: 0 };
  }

  // Only rows that are still awaiting a check - already-marked replies
  // don't need re-matching, and a currently-sending row isn't done yet.
  const candidates = db
    .prepare("SELECT id, subject, recipients FROM tracked_emails WHERE user_id = ? AND replied_at IS NULL AND status IN ('sent', 'opened', 'clicked')")
    .all(userId);

  let newReplies = 0;
  const notifyStmt = db.prepare("INSERT INTO app_notifications (user_id, type, title, message, link) VALUES (?, 'reply_detected', ?, ?, ?)");
  const markRepliedStmt = db.prepare("UPDATE tracked_emails SET replied_at = datetime('now') WHERE id = ?");
  const markCampaignLeadStmt = db.prepare("UPDATE email_campaign_leads SET replied_at = datetime('now') WHERE tracked_email_id = ?");

  for (const email of candidates) {
    let recipients = [];
    try {
      recipients = JSON.parse(email.recipients || "[]");
    } catch {
      recipients = [];
    }
    const matched = recipients.some((r) => repliedAddresses.has((r || "").toLowerCase().trim()));
    if (!matched) continue;

    markRepliedStmt.run(email.id);
    markCampaignLeadStmt.run(email.id); // no-op if this email isn't linked to a campaign lead
    newReplies++;
    notifyStmt.run(
      userId,
      "Reply received",
      `"${email.subject || "(no subject)"}" got a reply from ${recipients[0] || "a recipient"}.`,
      `lead-email:${email.id}`
    );
  }

  db.prepare("UPDATE users SET last_reply_check_at = datetime('now') WHERE id = ?").run(userId);
  return { ok: true, newReplies };
}

// Runs the check for every user who has IMAP/SMTP configured - called
// periodically, independent of whether any campaign is currently
// running, since manually-sent emails deserve the same reply visibility.
async function checkRepliesForAllUsers() {
  const users = db
    .prepare("SELECT id FROM users WHERE tracker_smtp_host IS NOT NULL AND tracker_smtp_user IS NOT NULL AND tracker_smtp_pass IS NOT NULL")
    .all();
  for (const user of users) {
    try {
      const result = await checkRepliesForUser(user.id);
      if (!result.ok) console.error(`[reply-checker] Check failed for user ${user.id}:`, result.error);
    } catch (err) {
      console.error(`[reply-checker] Unexpected error for user ${user.id}:`, err.message);
    }
  }
}

module.exports = { checkRepliesForUser, checkRepliesForAllUsers };
