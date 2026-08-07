const express = require("express");
const db = require("../db");
const { hasSmtpConfigured } = require("../campaignSender");

const router = express.Router();

// POST /api/campaigns { name, nicheId, catchLogId, leadIds?, requireInspection, tone, length, language, cta, meeting, meetingLink, maxPerDay, minGapMinutes, maxGapMinutes }
// leadIds omitted -> every lead currently in the given niche/catch-log scope with an email on file
router.post("/", (req, res) => {
  const userId = req.session.userId;
  const {
    name,
    nicheId,
    catchLogId,
    leadIds,
    requireInspection,
    tone,
    length,
    language,
    cta,
    meeting,
    meetingLink,
    maxPerDay,
    minGapMinutes,
    maxGapMinutes,
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
      return !!JSON.parse(l.socials || "{}").email;
    } catch {
      return false;
    }
  });

  if (emailable.length === 0) {
    return res.status(400).json({ error: "None of the leads in this scope have an email address on file - nothing to send to." });
  }

  const info = db
    .prepare(
      `INSERT INTO email_campaigns (user_id, name, niche_id, catch_log_id, require_inspection, tone, length, language, cta, meeting, meeting_link, max_per_day, min_gap_minutes, max_gap_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      name.trim(),
      nicheId || null,
      catchLogId || null,
      requireInspection ? 1 : 0,
      tone,
      length || "Medium",
      language || "English",
      cta ? 1 : 0,
      meeting ? 1 : 0,
      meetingLink || null,
      Math.min(maxPerDay || 100, 100),
      minGapMinutes || 5,
      maxGapMinutes || 10
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
        (SELECT COUNT(*) FROM email_campaign_leads WHERE campaign_id = c.id AND status = 'skipped') AS skipped_count
       FROM email_campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.session.userId);
  res.json({ campaigns: rows });
});

// GET /api/campaigns/:id -> detail with the full per-lead queue
router.get("/:id", (req, res) => {
  const campaign = db.prepare("SELECT * FROM email_campaigns WHERE id = ? AND user_id = ?").get(req.params.id, req.session.userId);
  if (!campaign) return res.status(404).json({ error: "Not found" });

  const leads = db
    .prepare(
      `SELECT ecl.id, ecl.status, ecl.error, ecl.sent_at, ecl.tracked_email_id, l.name AS lead_name
       FROM email_campaign_leads ecl JOIN leads l ON l.id = ecl.lead_id
       WHERE ecl.campaign_id = ? ORDER BY ecl.id ASC`
    )
    .all(campaign.id);

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

router.post("/:id/cancel", requireOwnedCampaign, (req, res) => {
  db.prepare("UPDATE email_campaigns SET status = 'cancelled' WHERE id = ?").run(req.campaign.id);
  res.json({ ok: true });
});

module.exports = router;
