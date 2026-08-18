const crypto = require("crypto");
const db = require("./db");
const analysisJobs = require("./analysisJobs");
const { isValidEmailAddress } = require("./emailValidation");
const { generateOutreachContent, generateFollowUpContent } = require("./outreachContent");
const { buildTrackedHtmlEmail } = require("./campaignEmailBuilder");
const { sendCampaignEmail, resolveSmtpConfig, checkForReply } = require("./campaignSender");
const { getSetting } = require("./settingsStore");

const TICK_INTERVAL_MS = 60000; // check every minute whether any campaign is due to send
const INSPECTION_TIMEOUT_MS = 120000; // give a single inspection up to 2 minutes before giving up

// campaignId -> true while a tick is actively processing that campaign -
// prevents two overlapping ticks from both trying to send for the same
// campaign if one send takes longer than the tick interval.
const busyCampaigns = new Set();

function randomGapMs(minMinutes, maxMinutes) {
  const minMs = minMinutes * 60000;
  const maxMs = maxMinutes * 60000;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

function notifyUser(userId, { type, title, message, link }) {
  try {
    db.prepare("INSERT INTO app_notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)").run(userId, type, title, message, link || null);
  } catch (err) {
    console.error(`[campaign] Failed to persist notification for user ${userId}:`, err.message);
  }
  console.log(`[campaign] Notice for user ${userId}: ${title} - ${message}`);
}

function countSentToday(campaignId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM email_campaign_leads WHERE campaign_id = ? AND status = 'sent' AND date(sent_at) = date('now')`)
    .get(campaignId);
  return row.c;
}

// Finds leads whose most recent touch is 'sent', past the configured
// wait period, and hasn't already had a follow-up scheduled - safety-
// checks each one for a reply via IMAP before creating the next touch.
// Processes at most one candidate per tick (each check is a live IMAP
// connection, and this deliberately doesn't need to be fast - a
// follow-up being a few minutes later than the exact due time doesn't
// matter the way an overdue campaign send might).
async function scheduleFollowUps(campaign) {
  if (!campaign.followup_enabled) return;

  // Only the most recent touch per lead - a lead already on touch 2
  // shouldn't also get a follow-up scheduled off its touch 1 row. Also
  // excludes any lead whose most recent send actually bounced - an
  // undeliverable/non-existent address from an earlier touch should
  // never get another attempt, both because it's pointless (the address
  // doesn't work) and because repeatedly emailing a bouncing address
  // hurts sender reputation for every other send too.
  const candidates = db
    .prepare(
      `SELECT ecl.*,
              (SELECT sent_at FROM email_campaign_leads WHERE campaign_id = ecl.campaign_id AND lead_id = ecl.lead_id AND status = 'sent' ORDER BY touch_number ASC LIMIT 1) AS first_touch_sent_at
       FROM email_campaign_leads ecl
       LEFT JOIN tracked_emails te ON te.id = ecl.tracked_email_id
       WHERE ecl.campaign_id = ?
         AND ecl.status = 'sent'
         AND ecl.touch_number < ?
         AND ecl.replied_at IS NULL
         AND te.delivery_failed_at IS NULL
         AND ecl.id = (SELECT MAX(id) FROM email_campaign_leads WHERE campaign_id = ecl.campaign_id AND lead_id = ecl.lead_id)
       ORDER BY ecl.sent_at ASC`
    )
    .all(campaign.id, campaign.followup_max_count + 1);

  for (const row of candidates) {
    // Anchored to the FIRST email ever sent to this lead, not the most
    // recent touch - so if an earlier touch goes out later than
    // scheduled (a pause, a delayed pickup, etc.), the whole sequence
    // doesn't drift forward with it. Touch N's due date is always
    // first-send + (N-1) * wait_days, computed fresh every tick rather
    // than compounding delays touch over touch.
    const firstSentAtMs = new Date((row.first_touch_sent_at || row.sent_at).replace(" ", "T") + "Z").getTime();
    const nextTouchNumber = row.touch_number + 1;
    const dueAtMs = firstSentAtMs + (nextTouchNumber - 1) * campaign.followup_wait_days * 86400000;
    if (Date.now() < dueAtMs) continue;

    // This specific next touch level might have been paused independently
    // of the rest of the sequence (see the per-followup pause/resume
    // routes) - a different lead due for a different touch number should
    // still be processed this tick, so this only skips this one candidate.
    const touchConfig = db.prepare("SELECT status FROM campaign_followup_configs WHERE campaign_id = ? AND touch_number = ?").get(campaign.id, nextTouchNumber);
    if (touchConfig?.status === "paused") continue;

    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(row.lead_id);
    if (!lead) continue;
    if (lead.outreach_excluded_at) continue; // permanently excluded (Engaged/Won/Converted) - never gets another touch, no matter how it reached that status
    let socials = {};
    try {
      socials = JSON.parse(lead.socials || "{}");
    } catch {
      socials = {};
    }
    if (!isValidEmailAddress(socials.email)) continue;

    let replied = false;
    try {
      replied = await checkForReply(campaign.user_id, socials.email, new Date(sentAtMs), campaign.send_provider);
    } catch (err) {
      // Can't confirm it's safe to follow up - skip this tick and try
      // again next time rather than risk sending on top of a reply we
      // simply failed to detect.
      console.error(`[campaign] Reply check failed for campaign ${campaign.id}, lead ${lead.id}:`, err.message);
      continue;
    }

    if (replied) {
      db.prepare("UPDATE email_campaign_leads SET replied_at = datetime('now') WHERE id = ?").run(row.id);
      continue;
    }

    db.prepare("INSERT INTO email_campaign_leads (campaign_id, lead_id, status, touch_number) VALUES (?, ?, 'pending', ?)").run(
      campaign.id,
      row.lead_id,
      nextTouchNumber
    );
    return; // one per tick - the next candidate gets picked up on a later tick
  }
}

async function waitForInspection(userId, lead, aiProvider) {
  const existing = analysisJobs.getAnalysis(lead.id);
  if (existing && existing.status === "done") return existing;

  if (!existing || (existing.status !== "running" && existing.status !== "pending")) {
    analysisJobs.startAnalysis(userId, lead, aiProvider);
  }

  const start = Date.now();
  while (Date.now() - start < INSPECTION_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = analysisJobs.getAnalysis(lead.id);
    if (check && check.status === "done") return check;
    if (check && check.status === "failed") throw new Error(`Inspection failed: ${check.error || "unknown error"}`);
  }
  throw new Error("Inspection timed out");
}

// Simple strip for feeding a previous email's HTML body to the AI as
// follow-up context - doesn't need to be pixel-perfect, just readable.
function stripHtmlForContext(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function processCampaignLead(campaign, campaignLeadRow) {
  const lead = db
    .prepare(
      `SELECT l.*, cl.name AS city_name, n.name AS niche_name FROM leads l
       JOIN catch_logs cl ON cl.id = l.catch_log_id JOIN niches n ON n.id = cl.niche_id
       WHERE l.id = ?`
    )
    .get(campaignLeadRow.lead_id);

  if (!lead) {
    db.prepare("UPDATE email_campaign_leads SET status = 'skipped', error = ? WHERE id = ?").run("Lead no longer exists", campaignLeadRow.id);
    return { ok: true, skipped: true };
  }

  let socials = {};
  try {
    socials = JSON.parse(lead.socials || "{}");
  } catch {
    socials = {};
  }
  if (!isValidEmailAddress(socials.email)) {
    db.prepare("UPDATE email_campaign_leads SET status = 'skipped', error = ? WHERE id = ?").run(
      socials.email ? `Malformed email address on file: "${socials.email}"` : "No email address on file for this lead",
      campaignLeadRow.id
    );
    return { ok: true, skipped: true };
  }

  // Resolve which AI provider to use: an explicit campaign-level choice
  // wins, otherwise fall back to whatever the user has saved as their
  // default for each step (content vs inspection can differ), otherwise
  // Auto (the normal fallback chain).
  const userProviderPrefs = db
    .prepare("SELECT preferred_content_provider, preferred_inspection_provider FROM users WHERE id = ?")
    .get(campaign.user_id);
  const inspectionProvider = campaign.ai_provider || userProviderPrefs?.preferred_inspection_provider || undefined;
  const contentProvider = campaign.ai_provider || userProviderPrefs?.preferred_content_provider || undefined;

  const isFollowUp = campaignLeadRow.touch_number > 1;
  let genResult;
  let previousSubject = null;

  if (isFollowUp) {
    // Follow-ups skip inspection entirely - the original email already
    // used whatever analysis was available, and re-inspecting the same
    // business for a two-sentence bump message isn't useful.
    const previousTouch = db
      .prepare(
        "SELECT * FROM email_campaign_leads WHERE campaign_id = ? AND lead_id = ? AND touch_number = ? AND tracked_email_id IS NOT NULL"
      )
      .get(campaign.id, campaignLeadRow.lead_id, campaignLeadRow.touch_number - 1);
    const previousEmail = previousTouch?.tracked_email_id
      ? db.prepare("SELECT subject, body_html FROM tracked_emails WHERE id = ?").get(previousTouch.tracked_email_id)
      : null;

    if (!previousEmail) throw new Error("Could not find the previous email to follow up on");
    previousSubject = previousEmail.subject;

    db.prepare("UPDATE email_campaign_leads SET status = 'generating' WHERE id = ?").run(campaignLeadRow.id);
    const userRow = db.prepare("SELECT signature, signature_font_family, signature_font_size FROM users WHERE id = ?").get(campaign.user_id);
    const followupConfig = db
      .prepare("SELECT * FROM campaign_followup_configs WHERE campaign_id = ? AND touch_number = ?")
      .get(campaign.id, campaignLeadRow.touch_number);
    genResult = await generateFollowUpContent(campaign.user_id, {
      lead,
      tone: followupConfig?.tone ?? campaign.tone,
      language: followupConfig?.language ?? campaign.language ?? "English",
      previousBody: stripHtmlForContext(previousEmail.body_html),
      touchNumber: campaignLeadRow.touch_number,
      signature: userRow?.signature,
      signatureFontFamily: userRow?.signature_font_family,
      signatureFontSize: userRow?.signature_font_size,
      aiProvider: followupConfig?.ai_provider || contentProvider,
      analysis: analysisJobs.getAnalysis(lead.id),
      meeting: followupConfig ? !!followupConfig.meeting : !!campaign.meeting,
      meetingLink: followupConfig?.meeting_link ?? campaign.meeting_link,
      whatsapp: followupConfig ? !!followupConfig.whatsapp : !!campaign.whatsapp,
      whatsappLink: followupConfig?.whatsapp_link ?? campaign.whatsapp_link,
      customInstructions: followupConfig?.custom_instructions ?? campaign.followup_custom_instructions,
    });
  } else {
    // Step 1: inspect first, if requested and not already done
    let analysis = null;
    if (campaign.require_inspection) {
      db.prepare("UPDATE email_campaign_leads SET status = 'inspecting' WHERE id = ?").run(campaignLeadRow.id);
      analysis = await waitForInspection(campaign.user_id, lead, inspectionProvider);
    } else {
      analysis = analysisJobs.getAnalysis(lead.id);
    }

    // Step 2: generate the email content
    db.prepare("UPDATE email_campaign_leads SET status = 'generating' WHERE id = ?").run(campaignLeadRow.id);
    const userRow = db.prepare("SELECT signature, signature_font_family, signature_font_size FROM users WHERE id = ?").get(campaign.user_id);
    genResult = await generateOutreachContent(campaign.user_id, {
      lead,
      platform: "email",
      tone: campaign.tone,
      length: campaign.length,
      analysis,
      signature: userRow?.signature,
      signatureFontFamily: userRow?.signature_font_family,
      signatureFontSize: userRow?.signature_font_size,
      language: campaign.language || "English",
      cta: !!campaign.cta,
      meeting: !!campaign.meeting,
      meetingLink: campaign.meeting_link,
      whatsapp: !!campaign.whatsapp,
      whatsappLink: campaign.whatsapp_link,
      aiProvider: contentProvider,
    });
  }
  if (!genResult.ok) throw new Error(`Content generation failed: ${genResult.error}`);

  const subject = isFollowUp ? `Re: ${previousSubject}` : genResult.subject || "A quick idea for your business";

  // Persist to outreach_content too, not just the sent email - this is
  // what the lead's own "Generate Content" panel reads from, so without
  // this, content a campaign generated and sent would be invisible when
  // checked later from the lead's expand panel (it would show "not
  // generated yet" despite having actually been generated and sent).
  // Follow-ups are deliberately excluded - this table represents the
  // lead's main pitch, not each individual bump message, and a follow-up
  // overwriting it would erase the original pitch from view.
  if (!isFollowUp) {
    db.prepare(
      `INSERT INTO outreach_content (lead_id, platform, tone, length, content, subject, provider, language, generated_at) VALUES (?, 'email', ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(lead_id, platform, language) DO UPDATE SET tone = excluded.tone, length = excluded.length, content = excluded.content, subject = excluded.subject, provider = excluded.provider, generated_at = excluded.generated_at`
    ).run(lead.id, campaign.tone, campaign.length || null, genResult.content, genResult.subject || null, genResult.provider || null, campaign.language || "English");
  }

  // Step 3: create the tracked_email record (same table/mechanism the
  // extension's create-email call uses, just invoked directly in-process
  // instead of over HTTP with an API key)
  const smtpCfg = resolveSmtpConfig(campaign.user_id, campaign.send_provider);
  const trackedId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tracked_emails (id, user_id, subject, recipients, sender, provider, status) VALUES (?, ?, ?, ?, ?, ?, 'sent')`
  ).run(trackedId, campaign.user_id, subject, JSON.stringify([socials.email]), smtpCfg?.from || null, campaign.send_provider);

  // Step 4: build the tracked HTML and send
  const baseUrl = getSetting("app_base_url") || "http://localhost:3000";
  let templateSettings = null;
  let universalLinks = null;
  let logoUrl = null;
  if (campaign.email_template_key) {
    const userLinksRow = db
      .prepare("SELECT facebook_link, instagram_link, linkedin_link, tiktok_link, email_logo_path FROM users WHERE id = ?")
      .get(campaign.user_id);
    const customRow = db.prepare("SELECT settings FROM email_templates WHERE user_id = ? AND template_key = ?").get(campaign.user_id, campaign.email_template_key);
    templateSettings = customRow ? JSON.parse(customRow.settings) : null;
    universalLinks = {
      facebookLink: userLinksRow?.facebook_link,
      instagramLink: userLinksRow?.instagram_link,
      linkedinLink: userLinksRow?.linkedin_link,
      tiktokLink: userLinksRow?.tiktok_link,
    };
    logoUrl = userLinksRow?.email_logo_path;
  }
  const html = buildTrackedHtmlEmail({
    bodyText: genResult.content,
    signatureHtml: genResult.signatureHtml,
    pixelUrl: `${baseUrl}/t/${trackedId}/pixel.png`,
    clickBaseUrl: `${baseUrl}/t/${trackedId}/click`,
    baseUrl,
    templateKey: campaign.email_template_key || null,
    templateSettings,
    universalLinks,
    logoUrl,
  });

  db.prepare("UPDATE email_campaign_leads SET status = 'sending' WHERE id = ?").run(campaignLeadRow.id);
  const sendResult = await sendCampaignEmail(campaign.user_id, { to: socials.email, subject, html }, campaign.send_provider);
  if (!sendResult.ok) {
    db.prepare("DELETE FROM tracked_emails WHERE id = ?").run(trackedId); // never sent - don't leave a phantom tracked row
    throw new Error(sendResult.error);
  }

  db.prepare("UPDATE tracked_emails SET body_html = ? WHERE id = ?").run(html, trackedId);
  db.prepare("UPDATE email_campaign_leads SET status = 'sent', tracked_email_id = ?, sent_at = datetime('now') WHERE id = ?").run(trackedId, campaignLeadRow.id);
  db.prepare("UPDATE leads SET status = 'contacted' WHERE id = ? AND status IN ('new', 'shortlisted')").run(lead.id);
  db.prepare("UPDATE email_campaigns SET auto_resume_attempts = 0 WHERE id = ? AND auto_resume_attempts > 0").run(campaign.id);
  return { ok: true, skipped: false };
}

const AUTO_RESUME_WAIT_MS = 5 * 60 * 1000;
const MAX_AUTO_RESUME_ATTEMPTS = 5; // ~25 minutes of retrying a transient issue before requiring manual review, so a genuinely broken config (wrong password, etc.) doesn't retry forever

// A campaign auto-paused by an actual failure (SMTP rejecting the send,
// the AI provider erroring out, etc.) gets a few automatic chances to
// recover on its own - many of these are transient (a brief provider
// outage, a momentary rate limit) and don't need a person to notice and
// click Resume by hand. A campaign the person paused themselves is never
// touched here - see the exact 'Paused manually' string the manual
// pause route uses, which this deliberately excludes.
function autoResumeStalledCampaigns() {
  const candidates = db
    .prepare(
      `SELECT * FROM email_campaigns
       WHERE status = 'paused'
         AND pause_reason IS NOT NULL
         AND pause_reason != 'Paused manually'
         AND auto_resume_attempts < ?
         AND paused_at IS NOT NULL
         AND paused_at <= datetime('now', '-5 minutes')`
    )
    .all(MAX_AUTO_RESUME_ATTEMPTS);

  for (const campaign of candidates) {
    db.prepare("UPDATE email_campaign_leads SET status = 'pending', error = NULL WHERE campaign_id = ? AND status IN ('failed', 'inspecting', 'generating', 'sending')").run(campaign.id);
    db.prepare(
      "UPDATE email_campaigns SET status = 'running', paused_at = NULL, pause_reason = NULL, auto_resume_attempts = auto_resume_attempts + 1 WHERE id = ?"
    ).run(campaign.id);
    console.log(`[campaign-scheduler] Auto-resumed campaign ${campaign.id} after a ${campaign.pause_reason.slice(0, 80)} failure (attempt ${campaign.auto_resume_attempts + 1}/${MAX_AUTO_RESUME_ATTEMPTS}).`);
    notifyUser(campaign.user_id, {
      type: "campaign_auto_resumed",
      title: "Campaign auto-resumed",
      message: `"${campaign.name}" was paused by a failure and has been automatically resumed.`,
      link: `campaign:${campaign.id}`,
    });
  }
}

async function tick() {
  autoResumeStalledCampaigns();
  const campaigns = db.prepare("SELECT * FROM email_campaigns WHERE status = 'running'").all();

  for (const campaign of campaigns) {
    if (busyCampaigns.has(campaign.id)) continue;

    if (countSentToday(campaign.id) >= campaign.max_per_day) continue; // today's cap reached, try again tomorrow

    // Converts any due follow-up into a normal 'pending' row - this has
    // to run before the send-pacing gap check below, not after. That gap
    // check exists to space out actual sends, but a recent send from
    // ANY lead in this campaign (including another lead's follow-up)
    // would otherwise short-circuit this tick before scheduleFollowUps
    // ever got a chance to run its reply-check for a completely
    // different, unrelated lead. The row it creates still respects
    // pacing normally once the main send logic below picks it up.
    await scheduleFollowUps(campaign).catch((err) => console.error(`[campaign] Follow-up scheduling failed for campaign ${campaign.id}:`, err.message));

    const lastSent = db
      .prepare("SELECT sent_at FROM email_campaign_leads WHERE campaign_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1")
      .get(campaign.id);
    if (lastSent) {
      const elapsedMs = Date.now() - new Date(lastSent.sent_at.replace(" ", "T") + "Z").getTime();
      // Re-roll a fresh random gap each tick rather than storing a fixed
      // "next send time" - simpler, and statistically equivalent since
      // ticks run every minute anyway.
      if (elapsedMs < campaign.min_gap_minutes * 60000) continue;
      if (elapsedMs < randomGapMs(campaign.min_gap_minutes, campaign.max_gap_minutes)) continue;
    }

    const nextLead = db
      .prepare("SELECT * FROM email_campaign_leads WHERE campaign_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1")
      .get(campaign.id);

    if (!nextLead) {
      // Not actually done if a lead is still waiting on a future
      // follow-up - sent, hasn't hit its touch limit, hasn't replied.
      // Those don't show up as 'pending' yet (scheduleFollowUps only
      // creates that row once the wait period has actually elapsed), so
      // without this check the campaign would be marked complete while
      // follow-ups are still meant to go out later.
      const stillWaitingOnFollowUp = campaign.followup_enabled
        ? db
            .prepare(
              `SELECT 1 FROM email_campaign_leads
               WHERE campaign_id = ? AND status = 'sent' AND touch_number < ? AND replied_at IS NULL
                 AND id = (SELECT MAX(id) FROM email_campaign_leads WHERE campaign_id = ? AND lead_id = email_campaign_leads.lead_id)
               LIMIT 1`
            )
            .get(campaign.id, campaign.followup_max_count + 1, campaign.id)
        : null;
      if (stillWaitingOnFollowUp) continue;

      db.prepare("UPDATE email_campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(campaign.id);
      notifyUser(campaign.user_id, {
        type: "campaign_completed",
        title: "Campaign finished",
        message: `"${campaign.name}" - every lead has been processed.`,
        link: `campaign:${campaign.id}`,
      });
      continue;
    }

    busyCampaigns.add(campaign.id);
    try {
      await processCampaignLead(campaign, nextLead);
    } catch (err) {
      db.prepare("UPDATE email_campaign_leads SET status = 'failed', error = ? WHERE id = ?").run(err.message, nextLead.id);
      db.prepare("UPDATE email_campaigns SET status = 'paused', paused_at = datetime('now'), pause_reason = ? WHERE id = ?").run(err.message, campaign.id);
      notifyUser(campaign.user_id, {
        type: "campaign_paused",
        title: "Campaign paused",
        message: `"${campaign.name}" - ${err.message}`,
        link: `campaign:${campaign.id}`,
      });
    } finally {
      busyCampaigns.delete(campaign.id);
    }
  }
}

let tickTimer = null;
function startScheduler() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => console.error("[campaign-scheduler] Tick failed:", err));
  }, TICK_INTERVAL_MS);
}

module.exports = { startScheduler, tick, scheduleFollowUps, autoResumeStalledCampaigns };
