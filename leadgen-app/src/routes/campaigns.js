const express = require("express");
const db = require("../db");
const { isValidEmailAddress } = require("../emailValidation");
const { hasSmtpConfigured, checkForReply } = require("../campaignSender");

const router = express.Router();

// POST /api/campaigns { name, nicheId, catchLogId, leadIds?, requireInspection, tone, length, language, cta, meeting, meetingLink, maxPerDay, minGapMinutes, maxGapMinutes }
// leadIds omitted -> every lead currently in the given niche/catch-log scope with an email on file
router.post("/", (req, res) => {
  const userId = req.session.userId;
  const {
    name,
    nicheId,
    catchLogId,
    catchLogIds,
    leadIds,
    requireInspection,
    tone,
    length,
    language,
    cta,
    meeting,
    meetingLink,
    whatsapp,
    whatsappLink,
    maxPerDay,
    minGapMinutes,
    maxGapMinutes,
    aiProvider,
    followupEnabled,
    followupMaxCount,
    followupWaitDays,
    followupCustomInstructions,
    muteOpenedAlerts,
    muteClickedAlerts,
  } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: "Campaign name is required" });
  if (!tone) return res.status(400).json({ error: "Tone is required" });
  if (!hasSmtpConfigured(userId)) {
    return res.status(400).json({ error: "Set up SMTP on the Hostinger Setup page first - a campaign can't send without it." });
  }

  // Resolve the target lead list - either the explicit list given, or
  // every lead in the niche/catch-log scope. Either way, only leads with
  // an email on file can actually be targeted (checked at send time too,
  // but filtering here means the campaign's lead count is accurate from
  // the start rather than silently including un-sendable leads).
  let candidateLeads;
  if (Array.isArray(leadIds) && leadIds.length) {
    const placeholders = leadIds.map(() => "?").join(",");
    candidateLeads = db
      .prepare(
        `SELECT l.id, l.socials FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id JOIN niches n ON n.id = cl.niche_id
         WHERE l.id IN (${placeholders}) AND n.user_id = ?`
      )
      .all(...leadIds, userId);
  } else if (Array.isArray(catchLogIds) && catchLogIds.length) {
    const placeholders = catchLogIds.map(() => "?").join(",");
    candidateLeads = db
      .prepare(
        `SELECT l.id, l.socials FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id JOIN niches n ON n.id = cl.niche_id
         WHERE cl.id IN (${placeholders}) AND n.user_id = ?`
      )
      .all(...catchLogIds, userId);
  } else if (catchLogId) {
    candidateLeads = db
      .prepare(`SELECT l.id, l.socials FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id JOIN niches n ON n.id = cl.niche_id WHERE cl.id = ? AND n.user_id = ?`)
      .all(catchLogId, userId);
  } else if (nicheId) {
    candidateLeads = db
      .prepare(`SELECT l.id, l.socials FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id JOIN niches n ON n.id = cl.niche_id WHERE n.id = ? AND n.user_id = ?`)
      .all(nicheId, userId);
  } else {
    return res.status(400).json({ error: "Select a niche, a city, or a specific list of leads to target" });
  }

  const emailable = candidateLeads.filter((l) => {
    try {
      return isValidEmailAddress(JSON.parse(l.socials || "{}").email);
    } catch {
      return false;
    }
  });

  if (emailable.length === 0) {
    return res.status(400).json({ error: "None of the leads in this scope have an email address on file - nothing to send to." });
  }

  const resolvedCatchLogIds = Array.isArray(catchLogIds) && catchLogIds.length ? catchLogIds : catchLogId ? [catchLogId] : [];

  const info = db
    .prepare(
      `INSERT INTO email_campaigns (user_id, name, niche_id, catch_log_id, catch_log_ids, require_inspection, tone, length, language, cta, meeting, meeting_link, whatsapp, whatsapp_link, ai_provider, max_per_day, min_gap_minutes, max_gap_minutes, followup_enabled, followup_max_count, followup_wait_days, followup_custom_instructions, mute_opened_alerts, mute_clicked_alerts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      name.trim(),
      nicheId || null,
      resolvedCatchLogIds[0] || null,
      resolvedCatchLogIds.length ? JSON.stringify(resolvedCatchLogIds) : null,
      requireInspection ? 1 : 0,
      tone,
      length || "Medium",
      language || "English",
      cta ? 1 : 0,
      meeting ? 1 : 0,
      meetingLink || null,
      whatsapp ? 1 : 0,
      whatsappLink || null,
      aiProvider || "",
      maxPerDay || 100,
      minGapMinutes || 5,
      maxGapMinutes || 10,
      followupEnabled ? 1 : 0,
      Math.min(Math.max(parseInt(followupMaxCount, 10) || 2, 0), 10),
      Math.max(parseInt(followupWaitDays, 10) || 3, 1),
      followupCustomInstructions || null,
      muteOpenedAlerts ? 1 : 0,
      muteClickedAlerts ? 1 : 0
    );
  const campaignId = info.lastInsertRowid;

  const insertLead = db.prepare("INSERT INTO email_campaign_leads (campaign_id, lead_id) VALUES (?, ?)");
  const insertMany = db.transaction((leads) => {
    for (const lead of leads) insertLead.run(campaignId, lead.id);
  });
  insertMany(emailable);

  res.json({ ok: true, campaignId, leadCount: emailable.length, skippedCount: candidateLeads.length - emailable.length });
});

// GET /api/campaigns -> list with progress counts
router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id) AS total_leads,
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id AND status = 'sent') AS sent_count,
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id AND status = 'failed') AS failed_count,
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id AND status = 'skipped') AS skipped_count,
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id AND status NOT IN ('sent', 'failed', 'skipped')) AS pending_work_count,
        (SELECT l.catch_log_id FROM email_campaign_leads ecl2 JOIN leads l ON l.id = ecl2.lead_id
           WHERE ecl2.campaign_id = c.id GROUP BY l.catch_log_id ORDER BY COUNT(*) DESC LIMIT 1) AS dominant_catch_log_id
       FROM email_campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.session.userId);

  // Resolve each campaign's dominant city/country in one batch query
  // rather than one lookup per campaign row.
  const catchLogIds = [...new Set(rows.map((r) => r.dominant_catch_log_id).filter(Boolean))];
  const catchLogMap = new Map();
  if (catchLogIds.length) {
    const placeholders = catchLogIds.map(() => "?").join(",");
    db.prepare(`SELECT id, name, country, niche_id FROM catch_logs WHERE id IN (${placeholders})`)
      .all(...catchLogIds)
      .forEach((cl) => catchLogMap.set(cl.id, cl));
  }

  const enriched = rows.map((r) => {
    const cl = catchLogMap.get(r.dominant_catch_log_id);
    return { ...r, dominant_city_name: cl?.name || null, dominant_country: cl?.country || null };
  });

  res.json({ campaigns: enriched });
});

// GET /api/campaigns/:id -> detail with the full per-lead queue
router.get("/:id", (req, res) => {
  const campaign = db.prepare("SELECT * FROM email_campaigns WHERE id = ? AND user_id = ?").get(req.params.id, req.session.userId);
  if (!campaign) return res.status(404).json({ error: "Not found" });
  campaign.pending_work_count = db
    .prepare("SELECT COUNT(*) AS c FROM email_campaign_leads WHERE campaign_id = ? AND status NOT IN ('sent', 'failed', 'skipped')")
    .get(campaign.id).c;
  campaign.city_count = db
    .prepare(
      `SELECT COUNT(DISTINCT l.catch_log_id) AS c FROM email_campaign_leads ecl JOIN leads l ON l.id = ecl.lead_id WHERE ecl.campaign_id = ?`
    )
    .get(campaign.id).c;

  const leads = db
    .prepare(
      `SELECT ecl.id, ecl.status, ecl.error, ecl.sent_at, ecl.tracked_email_id, ecl.created_at, ecl.touch_number, ecl.replied_at,
              l.id AS lead_id, l.name AS lead_name, l.socials, l.address, l.phone, l.website, cl.name AS city_name,
              te.subject AS sent_subject, te.status AS tracked_status, te.open_count, te.click_count, te.first_opened_at, te.delivery_failed_at
       FROM email_campaign_leads ecl
       JOIN leads l ON l.id = ecl.lead_id
       JOIN catch_logs cl ON cl.id = l.catch_log_id
       LEFT JOIN tracked_emails te ON te.id = ecl.tracked_email_id
       WHERE ecl.campaign_id = ? ORDER BY ecl.id ASC`
    )
    .all(campaign.id)
    .map((row) => {
      let email = null;
      try {
        email = JSON.parse(row.socials || "{}").email || null;
      } catch {
        email = null;
      }
      const { socials, ...rest } = row;
      return { ...rest, recipient_email: email };
    });

  res.json({ campaign, leads });
});

function requireOwnedCampaign(req, res, next) {
  const campaign = db.prepare("SELECT * FROM email_campaigns WHERE id = ? AND user_id = ?").get(req.params.id, req.session.userId);
  if (!campaign) return res.status(404).json({ error: "Not found" });
  req.campaign = campaign;
  next();
}

router.post("/:id/start", requireOwnedCampaign, (req, res) => {
  if (req.campaign.status !== "draft") return res.status(400).json({ error: "Only a draft campaign can be started" });
  db.prepare("UPDATE email_campaigns SET status = 'running', started_at = datetime('now') WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

router.post("/:id/pause", requireOwnedCampaign, (req, res) => {
  if (req.campaign.status !== "running") return res.status(400).json({ error: "Only a running campaign can be paused" });
  db.prepare("UPDATE email_campaigns SET status = 'paused', paused_at = datetime('now'), pause_reason = 'Paused manually' WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

// Resuming retries whichever lead was mid-flight when a failure paused
// the campaign - without this, that lead's 'failed' status would never
// be picked up again since the scheduler only looks for 'pending' leads.
router.post("/:id/resume", requireOwnedCampaign, (req, res) => {
  if (req.campaign.status !== "paused") return res.status(400).json({ error: "Only a paused campaign can be resumed" });
  db.prepare("UPDATE email_campaign_leads SET status = 'pending', error = NULL WHERE campaign_id = ? AND status IN ('failed', 'inspecting', 'generating', 'sending')").run(req.campaign.id);
  db.prepare("UPDATE email_campaigns SET status = 'running', paused_at = NULL, pause_reason = NULL WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

// POST /api/campaigns/:id/leads/:leadRowId/skip - marks one specific lead
// as permanently skipped (not retried, unlike a plain resume which
// retries every failed lead) and resumes the campaign so the scheduler
// continues with whatever comes after it. This is what lets a single bad
// lead (e.g. a malformed email that somehow still made it through) be
// set aside without abandoning the rest of an otherwise-healthy campaign.
router.post("/:id/leads/:leadRowId/skip", requireOwnedCampaign, (req, res) => {
  const leadRow = db.prepare("SELECT * FROM email_campaign_leads WHERE id = ? AND campaign_id = ?").get(req.params.leadRowId, req.campaign.id);
  if (!leadRow) return res.status(404).json({ error: "Lead not found in this campaign" });

  db.prepare("UPDATE email_campaign_leads SET status = 'skipped', error = COALESCE(error, 'Skipped manually') WHERE id = ?").run(leadRow.id);

  if (req.campaign.status === "paused") {
    db.prepare("UPDATE email_campaigns SET status = 'running', paused_at = NULL, pause_reason = NULL WHERE id = ?").run(req.campaign.id);
  }
  res.json({ ok: true });
});

// POST /api/campaigns/:id/leads/:leadRowId/retry - resets one specific
// failed lead back to pending so the scheduler picks it up again on its
// next tick, and resumes the campaign if it was paused. Unlike skip
// (which sets a lead aside permanently), this is for when the failure
// looked transient (a momentary SMTP hiccup, a rate limit) and is worth
// trying again rather than giving up on that lead.
router.post("/:id/leads/:leadRowId/retry", requireOwnedCampaign, (req, res) => {
  const leadRow = db.prepare("SELECT * FROM email_campaign_leads WHERE id = ? AND campaign_id = ?").get(req.params.leadRowId, req.campaign.id);
  if (!leadRow) return res.status(404).json({ error: "Lead not found in this campaign" });
  if (leadRow.status !== "failed") return res.status(400).json({ error: "Only a failed lead can be retried" });

  db.prepare("UPDATE email_campaign_leads SET status = 'pending', error = NULL WHERE id = ?").run(leadRow.id);

  if (req.campaign.status === "paused") {
    db.prepare("UPDATE email_campaigns SET status = 'running', paused_at = NULL, pause_reason = NULL WHERE id = ?").run(req.campaign.id);
  }
  res.json({ ok: true });
});

// GET /api/campaigns/:id/upcoming-followups - every lead with a future
// follow-up still ahead of it: latest touch sent, not replied, and room
// left under followup_max_count. Reuses the exact same "latest touch per
// lead" query the scheduler itself uses (see scheduleFollowUps in
// campaignScheduler.js) so this list can never drift out of sync with
// what will actually happen.
router.get("/:id/upcoming-followups", requireOwnedCampaign, (req, res) => {
  if (!req.campaign.followup_enabled) return res.json({ upcoming: [] });

  const rows = db
    .prepare(
      `SELECT ecl.id, ecl.lead_id, ecl.touch_number, ecl.sent_at, l.name AS lead_name, l.socials
       FROM email_campaign_leads ecl
       JOIN leads l ON l.id = ecl.lead_id
       WHERE ecl.campaign_id = ?
         AND ecl.status = 'sent'
         AND ecl.touch_number < ?
         AND ecl.replied_at IS NULL
         AND ecl.id = (SELECT MAX(id) FROM email_campaign_leads WHERE campaign_id = ecl.campaign_id AND lead_id = ecl.lead_id)
       ORDER BY ecl.sent_at ASC`
    )
    .all(req.campaign.id, req.campaign.followup_max_count + 1);

  const upcoming = rows.map((row) => {
    let email = null;
    try {
      email = JSON.parse(row.socials || "{}").email || null;
    } catch {
      email = null;
    }
    const sentAtMs = new Date(row.sent_at.replace(" ", "T") + "Z").getTime();
    const scheduledAt = new Date(sentAtMs + req.campaign.followup_wait_days * 86400000).toISOString();
    return {
      campaignLeadId: row.id,
      leadId: row.lead_id,
      leadName: row.lead_name,
      recipientEmail: email,
      currentTouchNumber: row.touch_number,
      nextTouchNumber: row.touch_number + 1,
      scheduledAt,
      overdue: Date.now() >= sentAtMs + req.campaign.followup_wait_days * 86400000,
    };
  });

  res.json({ upcoming });
});

// POST /api/campaigns/:id/leads/:leadRowId/send-followup-now - jumps the
// wait entirely for one specific lead. Still runs the same reply check
// the normal scheduled path uses first (cheap, and this is exactly the
// safety check that stops a follow-up from landing on top of a reply
// that arrived but hasn't been detected yet) before queuing it -
// skipping that check just because this is manual would be a real risk,
// not just a formality.
router.post("/:id/leads/:leadRowId/send-followup-now", requireOwnedCampaign, async (req, res) => {
  const leadRow = db.prepare("SELECT * FROM email_campaign_leads WHERE id = ? AND campaign_id = ?").get(req.params.leadRowId, req.campaign.id);
  if (!leadRow) return res.status(404).json({ error: "Lead not found in this campaign" });
  if (leadRow.status !== "sent") return res.status(400).json({ error: "This lead doesn't have a pending follow-up to send" });

  const latest = db
    .prepare("SELECT MAX(id) AS maxId FROM email_campaign_leads WHERE campaign_id = ? AND lead_id = ?")
    .get(req.campaign.id, leadRow.lead_id);
  if (latest.maxId !== leadRow.id) return res.status(400).json({ error: "This isn't the most recent touch for this lead" });

  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadRow.lead_id);
  let socials = {};
  try {
    socials = JSON.parse(lead?.socials || "{}");
  } catch {
    socials = {};
  }
  if (!isValidEmailAddress(socials.email)) return res.status(400).json({ error: "No valid email address on file for this lead" });

  try {
    const sentAtMs = new Date(leadRow.sent_at.replace(" ", "T") + "Z").getTime();
    const replied = await checkForReply(req.campaign.user_id, socials.email, new Date(sentAtMs));
    if (replied) {
      db.prepare("UPDATE email_campaign_leads SET replied_at = datetime('now') WHERE id = ?").run(leadRow.id);
      return res.status(409).json({ error: "This lead has actually replied - marked as replied instead of sending a follow-up on top of it." });
    }
  } catch (err) {
    return res.status(502).json({ error: `Could not confirm no reply has arrived yet: ${err.message}` });
  }

  db.prepare("INSERT INTO email_campaign_leads (campaign_id, lead_id, status, touch_number) VALUES (?, ?, 'pending', ?)").run(
    req.campaign.id,
    leadRow.lead_id,
    leadRow.touch_number + 1
  );

  if (req.campaign.status === "paused") {
    db.prepare("UPDATE email_campaigns SET status = 'running', paused_at = NULL, pause_reason = NULL WHERE id = ?").run(req.campaign.id);
  }
  res.json({ ok: true });
});

// POST /api/campaigns/:id/leads/:leadRowId/stop-followups - permanently
// stops future follow-ups for this one lead without touching any of its
// earlier, already-sent touches. Works by inserting a 'skipped' row for
// the next touch number - this becomes the new "latest touch" for the
// lead, and since it isn't status='sent', the scheduler's own candidate
// query (which only ever looks at the latest touch) naturally never
// picks this lead up again. No changes needed to the scheduler itself.
router.post("/:id/leads/:leadRowId/stop-followups", requireOwnedCampaign, (req, res) => {
  const leadRow = db.prepare("SELECT * FROM email_campaign_leads WHERE id = ? AND campaign_id = ?").get(req.params.leadRowId, req.campaign.id);
  if (!leadRow) return res.status(404).json({ error: "Lead not found in this campaign" });

  const latest = db
    .prepare("SELECT MAX(id) AS maxId FROM email_campaign_leads WHERE campaign_id = ? AND lead_id = ?")
    .get(req.campaign.id, leadRow.lead_id);
  if (latest.maxId !== leadRow.id) return res.status(400).json({ error: "This isn't the most recent touch for this lead" });

  db.prepare("INSERT INTO email_campaign_leads (campaign_id, lead_id, status, touch_number, error) VALUES (?, ?, 'skipped', ?, 'Follow-ups stopped manually')").run(
    req.campaign.id,
    leadRow.lead_id,
    leadRow.touch_number + 1
  );
  res.json({ ok: true });
});

// POST /api/campaigns/:id/leads/bulk-delete { leadRowIds: [...] } - removes
// one or more leads from this campaign's roster. Doesn't touch the linked
// tracked_email - a deleted row that was already sent stays fully visible
// in Tracking/History, this only removes it from THIS campaign's own view.
// Refuses to delete a row the scheduler is actively mid-processing right
// now, to avoid a race with whatever it's in the middle of doing.
router.post("/:id/leads/bulk-delete", requireOwnedCampaign, (req, res) => {
  const { leadRowIds } = req.body || {};
  if (!Array.isArray(leadRowIds) || leadRowIds.length === 0) return res.status(400).json({ error: "leadRowIds must be a non-empty array" });

  const placeholders = leadRowIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, status FROM email_campaign_leads WHERE campaign_id = ? AND id IN (${placeholders})`)
    .all(req.campaign.id, ...leadRowIds);

  const busy = rows.filter((r) => ["inspecting", "generating", "sending"].includes(r.status));
  if (busy.length) {
    return res.status(409).json({ error: "One or more selected leads are actively being processed right now - try again in a moment." });
  }

  const info = db.prepare(`DELETE FROM email_campaign_leads WHERE campaign_id = ? AND id IN (${placeholders})`).run(req.campaign.id, ...leadRowIds);
  res.json({ ok: true, deleted: info.changes });
});

router.post("/:id/cancel", requireOwnedCampaign, (req, res) => {
  db.prepare("UPDATE email_campaigns SET status = 'cancelled' WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

// PUT /api/campaigns/:id - edit/rename/reconfig. Only allowed for draft or
// paused campaigns - a running campaign is actively being processed by
// the scheduler, and changing its settings mid-flight could race with an
// in-progress send (e.g. changing the tone while a lead is mid-generation).
// Pause it first if it needs adjusting.
router.put("/:id", requireOwnedCampaign, (req, res) => {
  if (!["draft", "paused"].includes(req.campaign.status)) {
    return res.status(400).json({ error: "Pause a running campaign before editing it." });
  }
  const {
    name,
    requireInspection,
    tone,
    length,
    language,
    cta,
    meeting,
    meetingLink,
    whatsapp,
    whatsappLink,
    aiProvider,
    maxPerDay,
    minGapMinutes,
    maxGapMinutes,
    followupEnabled,
    followupMaxCount,
    followupWaitDays,
    followupCustomInstructions,
    muteOpenedAlerts,
    muteClickedAlerts,
  } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: "Campaign name can't be empty" });

  db.prepare(
    `UPDATE email_campaigns SET
      name = COALESCE(?, name),
      require_inspection = COALESCE(?, require_inspection),
      tone = COALESCE(?, tone),
      length = COALESCE(?, length),
      language = COALESCE(?, language),
      cta = COALESCE(?, cta),
      meeting = COALESCE(?, meeting),
      meeting_link = ?,
      whatsapp = COALESCE(?, whatsapp),
      whatsapp_link = ?,
      ai_provider = COALESCE(?, ai_provider),
      max_per_day = COALESCE(?, max_per_day),
      min_gap_minutes = COALESCE(?, min_gap_minutes),
      max_gap_minutes = COALESCE(?, max_gap_minutes),
      followup_enabled = COALESCE(?, followup_enabled),
      followup_max_count = COALESCE(?, followup_max_count),
      followup_wait_days = COALESCE(?, followup_wait_days),
      followup_custom_instructions = ?,
      mute_opened_alerts = COALESCE(?, mute_opened_alerts),
      mute_clicked_alerts = COALESCE(?, mute_clicked_alerts)
     WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : null,
    requireInspection !== undefined ? (requireInspection ? 1 : 0) : null,
    tone ?? null,
    length ?? null,
    language ?? null,
    cta !== undefined ? (cta ? 1 : 0) : null,
    meeting !== undefined ? (meeting ? 1 : 0) : null,
    meetingLink !== undefined ? meetingLink || null : req.campaign.meeting_link,
    whatsapp !== undefined ? (whatsapp ? 1 : 0) : null,
    whatsappLink !== undefined ? whatsappLink || null : req.campaign.whatsapp_link,
    aiProvider !== undefined ? aiProvider : null,
    maxPerDay !== undefined ? maxPerDay : null,
    minGapMinutes ?? null,
    maxGapMinutes ?? null,
    followupEnabled !== undefined ? (followupEnabled ? 1 : 0) : null,
    followupMaxCount !== undefined ? Math.min(Math.max(parseInt(followupMaxCount, 10) || 0, 0), 10) : null,
    followupWaitDays !== undefined ? Math.max(parseInt(followupWaitDays, 10) || 1, 1) : null,
    followupCustomInstructions !== undefined ? followupCustomInstructions || null : req.campaign.followup_custom_instructions,
    muteOpenedAlerts !== undefined ? (muteOpenedAlerts ? 1 : 0) : null,
    muteClickedAlerts !== undefined ? (muteClickedAlerts ? 1 : 0) : null,
    req.campaign.id
  );

  const updated = db.prepare("SELECT * FROM email_campaigns WHERE id = ?").get(req.campaign.id);
  res.json({ ok: true, campaign: updated });
});

// DELETE /api/campaigns/:id - fully removes the campaign and its per-lead
// queue (cascades via the foreign key). Tracked emails already sent are
// untouched - they remain visible in Tracking/History regardless, since
// deleting the campaign shouldn't erase evidence of what was actually sent.
router.delete("/:id", requireOwnedCampaign, (req, res) => {
  db.prepare("DELETE FROM email_campaigns WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

module.exports = router;
