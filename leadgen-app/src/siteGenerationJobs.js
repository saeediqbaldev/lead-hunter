const db = require("./db");
const { COLOR_PRESETS, DESIGN_STYLES, generateSlug, generateSectionCopy } = require("./websiteGenerator");
const { renderModernTemplate } = require("./siteTemplates/modern");
const { renderMinimalTemplate } = require("./siteTemplates/minimal");
const { renderStandardTemplate } = require("./siteTemplates/standard");

const TEMPLATE_RENDERERS = {
  modern: renderModernTemplate,
  minimal: renderMinimalTemplate,
  standard: renderStandardTemplate,
};

const SECTION_ORDER = ["hero", "about", "services", "whyUs", "testimonial", "cta"];

// leadId -> { cancelled: boolean } - same in-memory job-tracking pattern
// already proven for Inspect and content generation.
const activeJobs = new Map();

function isCancelled(siteId) {
  return activeJobs.get(siteId)?.cancelled === true;
}

async function runSiteJob(userId, siteId, ctx) {
  const sectionsData = {};
  try {
    db.prepare("UPDATE generated_sites SET status = 'running', current_step = ? WHERE id = ?").run(`Writing ${SECTION_ORDER[0]}…`, siteId);

    for (const key of SECTION_ORDER) {
      if (isCancelled(siteId)) return;

      // Same throttling reasoning as content generation - stay well clear
      // of free-tier per-minute rate limits when firing several sequential
      // AI calls for one page.
      if (key !== SECTION_ORDER[0]) await new Promise((r) => setTimeout(r, 2500));

      db.prepare("UPDATE generated_sites SET current_step = ? WHERE id = ?").run(`Writing ${key}…`, siteId);
      const result = await generateSectionCopy(userId, key, ctx);

      if (isCancelled(siteId)) return;

      if (!result.ok) {
        db.prepare("UPDATE generated_sites SET status = 'failed', error = ?, current_step = NULL WHERE id = ?").run(result.error, siteId);
        return;
      }
      sectionsData[key] = result.data;
    }

    db.prepare("UPDATE generated_sites SET current_step = 'Assembling page…' WHERE id = ?").run(siteId);

    const row = db.prepare("SELECT * FROM generated_sites WHERE id = ?").get(siteId);
    const renderer = TEMPLATE_RENDERERS[row.design_style] || TEMPLATE_RENDERERS.modern;
    const preset = COLOR_PRESETS[row.color_preset] || COLOR_PRESETS.emerald;
    const userRow = db.prepare("SELECT meeting_link, website_link FROM users WHERE id = ?").get(userId);

    const html = renderer({
      businessName: row.business_name,
      niche: row.niche,
      city: row.city,
      sections: sectionsData,
      useVisuals: !!row.use_visuals,
      colorVars: preset.vars,
      meetingLink: userRow?.meeting_link || "",
      websiteFooterUrl: "https://xevenpixels.com",
    });

    db.prepare("UPDATE generated_sites SET status = 'done', current_step = NULL, html = ? WHERE id = ?").run(html, siteId);
  } catch (err) {
    db.prepare("UPDATE generated_sites SET status = 'failed', error = ?, current_step = NULL WHERE id = ?").run(err.message, siteId);
  } finally {
    activeJobs.delete(siteId);
  }
}

function startSiteGeneration(userId, { leadId, niche, city, businessName, designStyle, colorPreset, useVisuals, strengths, weaknesses }) {
  const style = DESIGN_STYLES[designStyle] ? designStyle : "modern";
  const preset = COLOR_PRESETS[colorPreset] ? colorPreset : "emerald";
  const slug = generateSlug(niche, city, businessName);

  const info = db
    .prepare(
      `INSERT INTO generated_sites (lead_id, user_id, slug, niche, city, business_name, design_style, color_preset, use_visuals, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(leadId || null, userId, slug, niche, city, businessName, style, preset, useVisuals ? 1 : 0);

  const siteId = info.lastInsertRowid;
  activeJobs.set(siteId, { cancelled: false });

  const ctx = { businessName, niche, city, strengths, weaknesses };
  runSiteJob(userId, siteId, ctx); // fire and forget - progress is polled via getSiteStatus()

  return { siteId, slug };
}

function getSiteStatus(siteId) {
  const row = db.prepare("SELECT id, status, current_step, error, slug FROM generated_sites WHERE id = ?").get(siteId);
  if (!row) return null;
  return { siteId: row.id, status: row.status, currentStep: row.current_step, error: row.error, slug: row.slug };
}

function stopSiteGeneration(siteId) {
  const job = activeJobs.get(siteId);
  if (job) job.cancelled = true;
  db.prepare("UPDATE generated_sites SET status = 'stopped', current_step = NULL WHERE id = ? AND status = 'running'").run(siteId);
}

module.exports = { startSiteGeneration, getSiteStatus, stopSiteGeneration, TEMPLATE_RENDERERS };
