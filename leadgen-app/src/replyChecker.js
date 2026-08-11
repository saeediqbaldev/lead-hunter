const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const db = require("./db");
const { resolveSmtpConfig, HOSTINGER_IMAP_HOST, HOSTINGER_IMAP_PORT } = require("./campaignSender");

// Catches the class of reply that passes every subject/header check above
// (a normal-looking subject, no Auto-Submitted header - many support
// ticket systems don't set either) but is still an automated
// acknowledgment, not a person actually writing back: "we've received
// your email, our team will review it, no reply is needed" and similar.
// Requires matching the body text itself, which the cheaper checks above
// never look at.
const AUTO_ACK_BODY_PATTERNS = [
  /we('ve| have) received your (email|message|inquiry|enquiry|request)/i,
  /our team will (review|respond|get back to you)/i,
  /you (can|will) expect (a reply|to receive a reply|a response)/i,
  /no (reply|response) is (needed|required|necessary)/i,
  /this is an automat(ed|ic) (response|reply|message|email|acknowledg)/i,
  /a?\s?ticket (has been|number|created|assigned)/i,
  /your request has been (logged|received|submitted)/i,
  /is just for your information.{0,20}(acknowledge|no reply)/i,
  /out of office|automatic reply/i,
];

function bodyLooksLikeAutoAck(text) {
  if (!text) return false;
  return AUTO_ACK_BODY_PATTERNS.some((p) => p.test(text));
}

const { generateWithFallback } = require("./aiProviders");

// Cheap pre-filter before ever calling the AI - the large majority of
// genuine replies don't redirect to another address at all, and this
// avoids a wasted call for all of them. Deliberately loose (a false
// pass here just costs one extra AI call, not a wrong outcome) since
// the AI call after it is what actually decides.
const REDIRECT_HINT_PATTERN = /instead|correct (department|email|address)|wrong (email|address|department)|forward(ed)? (this|your)|please contact|should be sent to|redirect/i;

function bodyHintsAtRedirect(text) {
  return /@/.test(text) && REDIRECT_HINT_PATTERN.test(text);
}

// Uses the AI to check whether a reply is redirecting the sender to a
// different contact address ("this mailbox isn't monitored, please
// email sales@company.com instead") - genuinely needs language
// understanding, not just a keyword match, to distinguish that from an
// incidental, unrelated mention of some other address in the message.
async function detectRedirectEmail(userId, bodyText) {
  const prompt = `An email reply is shown below. Determine whether it instructs the sender to contact a DIFFERENT email address instead of the one the reply came from - for example because the original email reached the wrong department, an unmonitored mailbox, or the wrong person.

Reply text:
"""
${bodyText}
"""

Respond with ONLY a JSON object, no other text:
{"hasRedirect": true or false, "suggestedEmail": "the email address to use instead, or null if hasRedirect is false", "reason": "a short phrase quoting or paraphrasing why, or null"}`;

  const result = await generateWithFallback(userId, prompt, { jsonMode: true, maxTokens: 300 });
  if (!result.ok) return { hasRedirect: false };
  try {
    const parsed = JSON.parse(result.text);
    if (!parsed.hasRedirect || !parsed.suggestedEmail) return { hasRedirect: false };
    // The AI can hallucinate a plausible-looking but wrong address - a
    // basic shape check is a cheap sanity floor before this gets
    // surfaced to the user as a suggestion.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.suggestedEmail.trim())) return { hasRedirect: false };
    return { hasRedirect: true, suggestedEmail: parsed.suggestedEmail.trim().toLowerCase(), reason: parsed.reason || null };
  } catch {
    return { hasRedirect: false };
  }
}

// How far back to look on a user's very first check - after that,
// last_reply_check_at takes over and each check only looks at what's
// arrived since the previous one, so this only matters once.
const FIRST_CHECK_LOOKBACK_DAYS = 30;

// Bounds on the second-pass body download/parse - acknowledgment phrases
// and "please contact X instead" redirects almost always appear in the
// first part of a message, not buried at the end, so there's no need to
// download or parse more than this to catch them.
const MAX_BODY_DOWNLOAD_BYTES = 50000;
const MAX_BODY_TEXT_CHARS = 3000;

// Headers checked for auto-reply/bulk-mail signals, fetched alongside
// the envelope. Not every mail system sets the RFC 3834-standard
// Auto-Submitted header reliably (some Exchange configurations don't),
// so several of the common non-standard alternatives are checked too -
// this is genuinely a "check everything you can, trust none of them
// alone" situation industry-wide, not a shortcut specific to this app.
const AUTO_REPLY_HEADER_NAMES = ["auto-submitted", "x-autoreply", "x-autorespond", "precedence", "content-type"];

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

// Deliberately stricter than isAutomatedReply above - that one only
// decides "don't count this as a reply," a low-stakes call to get
// slightly wrong. This one decides "move this email out of the inbox,"
// which needs to be right essentially every time. The RFC 3464 marker
// is trusted on its own since real mail practically never carries it;
// the subject/sender signals are only trusted in combination, never
// individually, since either alone is exactly the kind of thing a
// legitimate email could coincidentally match.
const BOUNCE_SUBJECT_PATTERN = /^(undeliverable|undelivered mail|mail delivery (failed|failure)|delivery status notification|returned mail|failure notice|mail system error)/i;
const BOUNCE_SENDER_PATTERN = /^(mailer-daemon|postmaster|mail delivery subsystem)/i;

function isBounceMessage(envelope, headersBuffer) {
  const headersText = (headersBuffer ? headersBuffer.toString("utf8") : "").toLowerCase();
  if (/content-type:[^\r\n]*(multipart\/report|report-type=delivery-status)/i.test(headersText)) return true;

  const subject = (envelope?.subject || "").trim();
  const fromAddress = extractEmailAddress(envelope?.from) || "";
  const fromName = (envelope?.from?.[0]?.name || "").trim();
  const senderLooksSystemic = BOUNCE_SENDER_PATTERN.test(fromAddress) || BOUNCE_SENDER_PATTERN.test(fromName);

  return BOUNCE_SUBJECT_PATTERN.test(subject) && senderLooksSystemic;
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
  const bounceUids = [];
  const bounceSummary = [];
  const MAX_BOUNCES_PER_CYCLE = 200; // defensive cap - if detection ever misbehaves, this limits the blast radius to one cycle's worth rather than the whole mailbox
  // Passed the cheap envelope/header checks, so provisionally look like a
  // genuine reply - body text hasn't been checked yet at this point.
  const candidateReplies = []; // { uid, address, date, subject }
  const redirectCandidates = []; // { address, subject, bodyText } - genuine replies whose body is worth an AI check for a "please contact this address instead" instruction, filled in below
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ since: sinceDate }, { uid: true });
      if (Array.isArray(uids) && uids.length) {
        for await (const message of client.fetch(uids, { envelope: true, headers: AUTO_REPLY_HEADER_NAMES }, { uid: true })) {
          if (isBounceMessage(message.envelope, message.headers)) {
            if (bounceUids.length < MAX_BOUNCES_PER_CYCLE) {
              bounceUids.push(message.uid);
              bounceSummary.push({ from: extractEmailAddress(message.envelope?.from), subject: message.envelope?.subject || "(no subject)" });
            }
            continue; // never counts as a reply either, regardless of the weaker auto-reply signals below
          }
          if (isAutomatedReply(message.envelope, message.headers)) continue; // out-of-office or bulk-mail marker - not a real reply
          const address = extractEmailAddress(message.envelope?.from);
          if (!address) continue;
          const messageDate = message.envelope?.date instanceof Date ? message.envelope.date : new Date();
          candidateReplies.push({ uid: message.uid, address, date: messageDate, subject: message.envelope?.subject || "" });
        }
      }

      // Second pass: only for messages that passed the cheap checks above
      // (a small subset, not the whole mailbox) - downloads and parses
      // the actual body text, since support-ticket-style acknowledgments
      // ("we've received your email, no reply needed") often use a
      // normal-looking subject and set none of the headers checked above,
      // so they'd otherwise be counted as a genuine reply.
      for (const candidate of candidateReplies) {
        let bodyText = "";
        try {
          const { content } = await client.download(String(candidate.uid), undefined, { uid: true, maxBytes: MAX_BODY_DOWNLOAD_BYTES });
          const parsed = await simpleParser(content);
          bodyText = (parsed.text || parsed.html || "").slice(0, MAX_BODY_TEXT_CHARS);
        } catch (err) {
          // Couldn't fetch/parse this one specific message's body - falls
          // back to trusting the cheaper checks it already passed, rather
          // than dropping it or failing the whole cycle over one message.
          console.error(`[reply-checker] Failed to fetch body for uid ${candidate.uid}:`, err.message);
        }

        if (bodyText && bodyLooksLikeAutoAck(bodyText)) continue; // an automated acknowledgment, not a genuine reply

        const existing = genuineReplies.get(candidate.address);
        if (!existing || candidate.date < existing) genuineReplies.set(candidate.address, candidate.date);
        if (bodyText) redirectCandidates.push({ address: candidate.address, subject: candidate.subject, bodyText });
      }

      // Moved to Trash, not permanently expunged - functionally "deleted"
      // from the inbox (which is what decluttering it actually requires),
      // while still leaving a recovery path if this was ever wrong about
      // a specific message, the same way deleting an email in any normal
      // mail client works.
      if (bounceUids.length) {
        try {
          const mailboxes = await client.list();
          const trashBox = mailboxes.find((m) => m.specialUse === "\\Trash") || mailboxes.find((m) => /trash|deleted/i.test(m.path));
          if (trashBox) {
            await client.messageMove(bounceUids, trashBox.path, { uid: true });
          } else {
            console.error("[reply-checker] Found bounce messages to remove but no Trash folder - leaving them in place.");
            bounceUids.length = 0;
            bounceSummary.length = 0;
          }
        } catch (err) {
          console.error("[reply-checker] Failed to move bounce messages to Trash:", err.message);
          bounceUids.length = 0;
          bounceSummary.length = 0;
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

  if (bounceSummary.length) {
    console.log(`[reply-checker] Moved ${bounceSummary.length} bounce message(s) to Trash for user ${userId}:`, bounceSummary.map((b) => `${b.from} - "${b.subject}"`));
    db.prepare("INSERT INTO app_notifications (user_id, type, title, message, link) VALUES (?, 'bounce_cleanup', ?, ?, NULL)").run(
      userId,
      "Cleaned up bounce emails",
      `Moved ${bounceSummary.length} "undelivered mail" notice${bounceSummary.length === 1 ? "" : "s"} to Trash.`
    );
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

    // If this reply's body hinted at a redirect ("please contact us at
    // this address instead"), check with the AI and - if confirmed -
    // store it on the lead as a suggestion. Never auto-resends anywhere;
    // this is surfaced for the user to review and act on themselves,
    // since acting on a wrong extraction would mean emailing an address
    // that never asked for it.
    const redirectCandidate = redirectCandidates.find((r) => r.address === matchedRecipient.toLowerCase().trim());
    if (redirectCandidate && bodyHintsAtRedirect(redirectCandidate.bodyText)) {
      try {
        const redirectResult = await detectRedirectEmail(userId, redirectCandidate.bodyText);
        if (redirectResult.hasRedirect) {
          const campaignLead = db.prepare("SELECT lead_id FROM email_campaign_leads WHERE tracked_email_id = ?").get(email.id);
          if (campaignLead) {
            db.prepare(
              "UPDATE leads SET suggested_contact_email = ?, suggested_contact_reason = ?, suggested_contact_detected_at = datetime('now') WHERE id = ?"
            ).run(redirectResult.suggestedEmail, redirectResult.reason, campaignLead.lead_id);
            db.prepare("INSERT INTO app_notifications (user_id, type, title, message, link) VALUES (?, 'contact_redirect', ?, ?, ?)").run(
              userId,
              "Reply suggests a different contact",
              `A reply to "${email.subject || "(no subject)"}" suggests emailing ${redirectResult.suggestedEmail} instead.`,
              `lead:${campaignLead.lead_id}`
            );
          }
        }
      } catch (err) {
        console.error(`[reply-checker] Redirect detection failed for tracked email ${email.id}:`, err.message);
      }
    }
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
