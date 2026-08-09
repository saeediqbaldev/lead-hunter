const { ImapFlow } = require("imapflow");
const db = require("./db");
const { resolveSmtpConfig, HOSTINGER_IMAP_HOST, HOSTINGER_IMAP_PORT } = require("./campaignSender");

// How far back to look on a user's very first check - after that,
// last_reply_check_at takes over and each check only looks at what's
// arrived since the previous one, so this only matters once.
const FIRST_CHECK_LOOKBACK_DAYS = 30;

// Headers checked for auto-reply/bulk-mail signals, fetched alongside
// the envelope. Not every mail system sets the RFC 3834-standard
// Auto-Submitted header reliably (some Exchange configurations don't),
// so several of the common non-standard alternatives are checked too -
// this is genuinely a "check everything you can, trust none of them
// alone" situation industry-wide, not a shortcut specific to this app.
const AUTO_REPLY_HEADER_NAMES = ["auto-submitted", "x-autoreply", "x-autorespond", "precedence"];

// Subject-line fallback for systems that set none of the above headers
// at all - out-of-office tools and legacy autoresponders are
// inconsistent about headers but consistently prefix the subject.
const AUTO_REPLY_SUBJECT_PATTERN =
  /^(auto(-|\s)?reply|automatic reply|out of office|out-of-office|away from|autoresponder|automated response|undeliverable|undelivered|mail delivery|delivery status notification|returned mail|vacation response)/i;

function isAutomatedReply(envelope, headersBuffer) {
  if (envelope?.subject && AUTO_REPLY_SUBJECT_PATTERN.test(envelope.subject.trim())) return true;

  const headersText = (headersBuffer ? headersBuffer.toString("utf8") : "").toLowerCase();
  if (/^auto-submitted:\s*(?!no\b)\S/im.test(headersText)) return true;
  if (/^x-autoreply:/im.test(headersText) || /^x-autorespond:/im.test(headersText)) return true;
  if (/^precedence:\s*(bulk|auto_reply|list)\b/im.test(headersText)) return true;

  return false;
}

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

  // Maps address -> the earliest genuine (non-automated) reply's actual
  // date, not just a boolean - this is what lets replied_at reflect when
  // the person actually wrote back, not whenever this check happened to
  // run, which was the root of the "six replies at the same minute"
  // confusion on the very first check after this feature shipped.
  let genuineReplies = new Map();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since: sinceDate }, { uid: true });
      if (Array.isArray(uids) && uids.length) {
        for await (const message of client.fetch(uids, { envelope: true, headers: AUTO_REPLY_HEADER_NAMES }, { uid: true })) {
          if (isAutomatedReply(message.envelope, message.headers)) continue; // out-of-office, bounce, or bulk-mail marker - not a real reply
          const address = extractEmailAddress(message.envelope?.from);
          if (!address) continue;
          const messageDate = message.envelope?.date instanceof Date ? message.envelope.date : new Date();
          const existing = genuineReplies.get(address);
          if (!existing || messageDate < existing) genuineReplies.set(address, messageDate);
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

  if (genuineReplies.size === 0) {
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
  const markRepliedStmt = db.prepare("UPDATE tracked_emails SET replied_at = ? WHERE id = ?");
  const markCampaignLeadStmt = db.prepare("UPDATE email_campaign_leads SET replied_at = ? WHERE tracked_email_id = ?");

  for (const email of candidates) {
    let recipients = [];
    try {
      recipients = JSON.parse(email.recipients || "[]");
    } catch {
      recipients = [];
    }
    const matchedRecipient = recipients.find((r) => genuineReplies.has((r || "").toLowerCase().trim()));
    if (!matchedRecipient) continue;

    const replyDate = genuineReplies.get(matchedRecipient.toLowerCase().trim());
    // SQLite's own datetime('now') format ("YYYY-MM-DD HH:MM:SS", UTC) -
    // stored consistently with every other timestamp in this app, rather
    // than a JS ISO string, so formatContactedTimestamp on the frontend
    // parses it the same way it parses everything else.
    const replyDateSql = replyDate.toISOString().slice(0, 19).replace("T", " ");

    markRepliedStmt.run(replyDateSql, email.id);
    markCampaignLeadStmt.run(replyDateSql, email.id); // no-op if this email isn't linked to a campaign lead
    newReplies++;
    notifyStmt.run(
      userId,
      "Reply received",
      `"${email.subject || "(no subject)"}" got a reply from ${matchedRecipient}.`,
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
