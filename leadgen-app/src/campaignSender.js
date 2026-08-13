const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const { ImapFlow } = require("imapflow");
const db = require("./db");

// Hostinger's IMAP host is fixed/well-known (confirmed by the user) -
// only the SMTP credentials need to be supplied, since Hostinger uses the
// same login for both SMTP and IMAP.
const HOSTINGER_IMAP_HOST = "imap.hostinger.com";
const HOSTINGER_IMAP_PORT = 993;

// Provider registry - each entry describes how to pull that provider's
// credentials out of the users row and, where the host itself is fixed
// and well-known (Gmail), what it is. Hostinger and Bluehost/Titan both
// use fully user-entered SMTP+IMAP hosts instead of a fixed one, since
// unlike Gmail's small number of stable, publicly documented endpoints,
// assuming a specific hostname for either would risk being wrong for a
// real account and silently failing to connect.
const PROVIDERS = {
  hostinger: {
    label: "Hostinger",
    smtpCols: { host: "tracker_smtp_host", port: "tracker_smtp_port", user: "tracker_smtp_user", pass: "tracker_smtp_pass", from: "tracker_smtp_from" },
    fixedImapHost: HOSTINGER_IMAP_HOST,
    fixedImapPort: HOSTINGER_IMAP_PORT,
  },
  gmail: {
    label: "Gmail",
    smtpCols: { user: "gmail_smtp_user", pass: "gmail_smtp_app_password" },
    fixedSmtpHost: "smtp.gmail.com",
    fixedSmtpPort: 587,
    fixedImapHost: "imap.gmail.com",
    fixedImapPort: 993,
  },
  bluehost_titan: {
    label: "Bluehost/Titan",
    smtpCols: { host: "bluehost_smtp_host", port: "bluehost_smtp_port", user: "bluehost_smtp_user", pass: "bluehost_smtp_pass", from: "bluehost_smtp_from" },
    imapCols: { host: "bluehost_imap_host", port: "bluehost_imap_port" },
  },
};

function resolveSmtpConfig(userId, provider = "hostinger") {
  const p = PROVIDERS[provider];
  if (!p) return null;

  const colNames = Object.values(p.smtpCols);
  const row = db.prepare(`SELECT ${colNames.join(", ")} FROM users WHERE id = ?`).get(userId);
  if (!row) return null;

  const user = row[p.smtpCols.user];
  const pass = row[p.smtpCols.pass];
  const host = p.fixedSmtpHost || row[p.smtpCols.host];
  const port = p.fixedSmtpPort || row[p.smtpCols.port] || 465;
  if (!host || !user || !pass) return null;

  return { host, port, user, pass, from: (p.smtpCols.from && row[p.smtpCols.from]) || user, provider };
}

function resolveImapConfig(userId, provider = "hostinger") {
  const p = PROVIDERS[provider];
  if (!p) return null;
  if (p.fixedImapHost) return { host: p.fixedImapHost, port: p.fixedImapPort };
  if (!p.imapCols) return null;
  const row = db.prepare(`SELECT ${p.imapCols.host}, ${p.imapCols.port} FROM users WHERE id = ?`).get(userId);
  const host = row?.[p.imapCols.host];
  if (!host) return null;
  return { host, port: row[p.imapCols.port] || 993 };
}

function buildRawMessage({ from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer({ from, to, subject, html });
    composer.compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message);
    });
  });
}

// Sends one campaign email: builds a single raw MIME buffer, sends it via
// SMTP, then appends that exact same buffer to the provider's "Sent" IMAP
// folder so it shows up in the mailbox exactly as if sent normally from
// that provider's own webmail. IMAP append failure is logged but doesn't
// fail the send itself - the email genuinely was sent and tracked either
// way, a missing Sent-folder copy is a lesser problem than silently not
// sending.
async function sendCampaignEmail(userId, { to, subject, html }, provider = "hostinger") {
  const cfg = resolveSmtpConfig(userId, provider);
  if (!cfg) {
    const label = PROVIDERS[provider]?.label || provider;
    return { ok: false, error: `${label} isn't fully configured yet - set it up on the ${label} Setup page first.` };
  }

  const raw = await buildRawMessage({ from: cfg.from, to, subject, html });

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  try {
    await transport.sendMail({ raw, envelope: { from: cfg.from, to } });
  } catch (err) {
    return { ok: false, error: `SMTP send failed: ${err.message}` };
  }

  try {
    const imapCfg = resolveImapConfig(userId, provider);
    if (imapCfg) await appendToSentFolder(cfg, imapCfg, raw);
  } catch (err) {
    console.error(`[campaign-sender] Sent via SMTP OK, but IMAP append to Sent folder failed for user ${userId} (${provider}):`, err.message);
  }

  return { ok: true };
}

async function appendToSentFolder(cfg, imapCfg, raw) {
  const client = new ImapFlow({
    host: imapCfg.host,
    port: imapCfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  try {
    // The Sent folder is conventionally named "Sent" across every
    // provider supported here - fall back to trying the common IMAP
    // special-use alternative if that exact name isn't present, rather
    // than silently doing nothing.
    const mailboxes = await client.list();
    const sentBox =
      mailboxes.find((m) => m.path === "Sent" || m.specialUse === "\\Sent") ||
      mailboxes.find((m) => m.path === "[Gmail]/Sent Mail") || // Gmail's own default naming
      mailboxes.find((m) => /sent/i.test(m.path));
    if (!sentBox) throw new Error("Could not find a Sent folder on this account");
    await client.append(sentBox.path, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => {});
  }
}

// Checks the inbox for any reply from a specific address since a given
// date - used before sending a follow-up, so a lead who already replied
// (even just to say "not interested") never gets a scheduled follow-up
// on top of that reply. A failed/unreachable IMAP check is treated as
// "can't confirm safety" rather than "no reply" - the caller should skip
// sending rather than risk it, since the cost of a false negative here
// (an unwanted follow-up landing on top of a real reply) is worse than
// the cost of a delayed follow-up.
async function checkForReply(userId, fromEmail, sinceDate, provider = "hostinger") {
  const cfg = resolveSmtpConfig(userId, provider);
  const imapCfg = resolveImapConfig(userId, provider);
  if (!cfg || !imapCfg) throw new Error(`SMTP/IMAP isn't configured for ${PROVIDERS[provider]?.label || provider}`);

  const client = new ImapFlow({
    host: imapCfg.host,
    port: imapCfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ from: fromEmail, since: sinceDate }, { uid: true });
      return Array.isArray(uids) && uids.length > 0;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Used by campaign creation to fail fast with a clear message rather than
// silently queuing a campaign that will fail on its very first send.
function hasSmtpConfigured(userId, provider = "hostinger") {
  return !!resolveSmtpConfig(userId, provider);
}

module.exports = {
  sendCampaignEmail,
  hasSmtpConfigured,
  resolveSmtpConfig,
  resolveImapConfig,
  checkForReply,
  PROVIDERS,
  HOSTINGER_IMAP_HOST,
  HOSTINGER_IMAP_PORT,
};
