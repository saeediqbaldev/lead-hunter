const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const asyncHandler = require("../asyncHandler");
const { testApiKey: testPlacesKey } = require("../placesApi");
const { testApiKey: testGeminiKey } = require("../gemini");
const { groqClient, deepseekClient, opencodeClient } = require("../openaiCompatible");
const apiKeys = require("../apiKeys");
const emailTemplates = require("../emailTemplates");
const { SIGNATURE_FONT_OPTIONS, DEFAULT_SIGNATURE_FONT_FAMILY, DEFAULT_SIGNATURE_FONT_SIZE, SIGNATURE_FONTS, GOOGLE_FONTS_IMPORT_URL } = require("../signatureFonts");
const db = require("../db");

const router = express.Router();

// GET /api/settings/profile -> the logged-in user's own username/role
router.get("/profile", (req, res) => {
  const row = db.prepare("SELECT username, role FROM users WHERE id = ?").get(req.session.userId);
  res.json({ username: row.username, role: row.role });
});

// PUT /api/settings/profile { currentPassword, newUsername?, newPassword? }
// Self-service account update - available to every user, admin included.
// Requires the current password to confirm identity before changing
// anything, same as any normal "change my account" flow.
router.put("/profile", (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: "Enter your current password to confirm this change." });
  }
  if (!newUsername?.trim() && !newPassword) {
    return res.status(400).json({ error: "Enter a new username and/or a new password." });
  }
  if (newPassword && newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  const finalUsername = newUsername?.trim() || user.username;

  try {
    if (newPassword) {
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?").run(finalUsername, hash, req.session.userId);
    } else {
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(finalUsername, req.session.userId);
    }
    req.session.username = finalUsername; // keep the session in sync so whoami reflects the change immediately
    res.json({ username: finalUsername });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "That username is already taken." });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/daily-cap -> this user's own daily lead cap
router.get("/daily-cap", (req, res) => {
  const row = db.prepare("SELECT daily_lead_cap FROM users WHERE id = ?").get(req.session.userId);
  res.json({ dailyLeadCap: (row && row.daily_lead_cap) || 300 });
});

// PUT /api/settings/daily-cap { dailyLeadCap }
router.put("/daily-cap", (req, res) => {
  const value = Number(req.body.dailyLeadCap);
  if (!Number.isFinite(value) || value < 1 || value > 5000) {
    return res.status(400).json({ error: "Enter a number between 1 and 5000" });
  }
  db.prepare("UPDATE users SET daily_lead_cap = ? WHERE id = ?").run(Math.round(value), req.session.userId);
  res.json({ dailyLeadCap: Math.round(value) });
});

const ALLOWED_PAGE_SIZES = [50, 100, 150, 200, 250, 300];

// GET /api/settings/page-size -> this user's saved records-per-page preference
router.get("/page-size", (req, res) => {
  const row = db.prepare("SELECT page_size FROM users WHERE id = ?").get(req.session.userId);
  res.json({ pageSize: (row && row.page_size) || 50 });
});

// PUT /api/settings/page-size { pageSize }
router.put("/page-size", (req, res) => {
  const value = Number(req.body.pageSize);
  if (!ALLOWED_PAGE_SIZES.includes(value)) {
    return res.status(400).json({ error: `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(", ")}` });
  }
  db.prepare("UPDATE users SET page_size = ? WHERE id = ?").run(value, req.session.userId);
  res.json({ pageSize: value });
});

// GET /api/settings/content-links -> this user's saved default meeting/whatsapp/website links, plus the universal links used by email templates (CTA + social)
router.get("/content-links", (req, res) => {
  const row = db
    .prepare(
      "SELECT meeting_link, website_link, whatsapp_link, cta_link, facebook_link, instagram_link, linkedin_link, tiktok_link, email_logo_path, default_email_template_key FROM users WHERE id = ?"
    )
    .get(req.session.userId);
  res.json({
    meetingLink: row.meeting_link || "",
    websiteLink: row.website_link || "",
    whatsappLink: row.whatsapp_link || "",
    ctaLink: row.cta_link || "",
    facebookLink: row.facebook_link || "",
    instagramLink: row.instagram_link || "",
    linkedinLink: row.linkedin_link || "",
    tiktokLink: row.tiktok_link || "",
    emailLogoUrl: row.email_logo_path || "",
    defaultTemplateKey: row.default_email_template_key || "minimal_branded",
  });
});

// PUT /api/settings/content-links { meetingLink?, websiteLink?, whatsappLink?, ctaLink?, facebookLink?, instagramLink?, linkedinLink?, tiktokLink? }
// Each field is independently optional - anything not included in the
// request body keeps its previously saved value rather than being
// wiped to null, since existing frontend code only sends a subset of
// these fields and must not silently erase the rest.
router.put("/content-links", (req, res) => {
  const { meetingLink, websiteLink, whatsappLink, ctaLink, facebookLink, instagramLink, linkedinLink, tiktokLink } = req.body || {};
  db.prepare(
    `UPDATE users SET
      meeting_link = COALESCE(?, meeting_link),
      website_link = COALESCE(?, website_link),
      whatsapp_link = COALESCE(?, whatsapp_link),
      cta_link = COALESCE(?, cta_link),
      facebook_link = COALESCE(?, facebook_link),
      instagram_link = COALESCE(?, instagram_link),
      linkedin_link = COALESCE(?, linkedin_link),
      tiktok_link = COALESCE(?, tiktok_link)
     WHERE id = ?`
  ).run(
    meetingLink !== undefined ? meetingLink || "" : null,
    websiteLink !== undefined ? websiteLink || "" : null,
    whatsappLink !== undefined ? whatsappLink || "" : null,
    ctaLink !== undefined ? ctaLink || "" : null,
    facebookLink !== undefined ? facebookLink || "" : null,
    instagramLink !== undefined ? instagramLink || "" : null,
    linkedinLink !== undefined ? linkedinLink || "" : null,
    tiktokLink !== undefined ? tiktokLink || "" : null,
    req.session.userId
  );
  const row = db
    .prepare("SELECT meeting_link, website_link, whatsapp_link, cta_link, facebook_link, instagram_link, linkedin_link, tiktok_link FROM users WHERE id = ?")
    .get(req.session.userId);
  res.json({
    meetingLink: row.meeting_link || "",
    websiteLink: row.website_link || "",
    whatsappLink: row.whatsapp_link || "",
    ctaLink: row.cta_link || "",
    facebookLink: row.facebook_link || "",
    instagramLink: row.instagram_link || "",
    linkedinLink: row.linkedin_link || "",
    tiktokLink: row.tiktok_link || "",
  });
});

const { DEFAULT_SIGNATURE } = require("../outreachContent");

// GET /api/settings/site-generator-meta -> design styles and color presets
// available, for populating the "Create Website" picker UI
router.get("/site-generator-meta", (req, res) => {
  const { DESIGN_STYLES, COLOR_PRESETS } = require("../websiteGenerator");
  res.json({
    designStyles: Object.entries(DESIGN_STYLES).map(([value, v]) => ({ value, ...v })),
    colorPresets: Object.entries(COLOR_PRESETS).map(([value, v]) => ({ value, label: v.label, swatch: v.swatch })),
  });
});

// GET /api/settings/signature -> this user's saved outreach signature
// GET /api/settings/signature-fonts - the available font options, for
// populating the signature editor's font dropdown, plus the combined
// Google Fonts stylesheet URL to actually load them in the editor.
// GET/PUT /api/settings/agency-profile - the free-text description of
// this agency's own services, experience, and niches, used to ground
// the AI fit-score/service-suggestion prompts in what this specific
// agency actually offers rather than generic marketing advice.
router.get("/agency-profile", (req, res) => {
  const row = db.prepare("SELECT agency_profile FROM users WHERE id = ?").get(req.session.userId);
  res.json({ agencyProfile: row?.agency_profile || "" });
});

router.put("/agency-profile", (req, res) => {
  const value = typeof req.body.agencyProfile === "string" ? req.body.agencyProfile.trim() : "";
  if (value.length > 4000) {
    return res.status(400).json({ error: "Keep this under 4,000 characters - a concise summary works better in the AI prompt than an exhaustive one." });
  }
  db.prepare("UPDATE users SET agency_profile = ? WHERE id = ?").run(value || null, req.session.userId);
  res.json({ agencyProfile: value });
});

router.get("/signature-fonts", (req, res) => {
  res.json({
    fonts: SIGNATURE_FONTS.map((f) => ({ value: f.value, label: f.label })),
    googleFontsImportUrl: GOOGLE_FONTS_IMPORT_URL,
  });
});

router.get("/signature", (req, res) => {
  const row = db.prepare("SELECT signature, signature_font_family, signature_font_size FROM users WHERE id = ?").get(req.session.userId);
  res.json({
    signature: row && row.signature != null ? row.signature : DEFAULT_SIGNATURE,
    fontFamily: row?.signature_font_family || DEFAULT_SIGNATURE_FONT_FAMILY,
    fontSize: row?.signature_font_size || DEFAULT_SIGNATURE_FONT_SIZE,
  });
});

// PUT /api/settings/signature { signature, fontFamily?, fontSize? }
router.put("/signature", (req, res) => {
  const value = typeof req.body.signature === "string" ? req.body.signature : "";
  // Now that images are stored as short file URLs (see the upload route
  // below) rather than embedded base64, the signature itself should
  // rarely need to be more than a few KB of text/HTML - this cap is a
  // sanity limit against something going wrong client-side, not a tight
  // budget the way the old 2000 was.
  if (value.length > 50000) {
    return res.status(400).json({ error: "Signature is too long (max 50,000 characters)." });
  }

  const fontFamily = SIGNATURE_FONT_OPTIONS.includes(req.body.fontFamily) ? req.body.fontFamily : DEFAULT_SIGNATURE_FONT_FAMILY;
  const fontSizeNum = parseInt(req.body.fontSize, 10);
  const fontSize = Number.isInteger(fontSizeNum) && fontSizeNum >= 6 && fontSizeNum <= 36 ? fontSizeNum : DEFAULT_SIGNATURE_FONT_SIZE;

  db.prepare("UPDATE users SET signature = ?, signature_font_family = ?, signature_font_size = ? WHERE id = ?").run(value, fontFamily, fontSize, req.session.userId);
  res.json({ signature: value, fontFamily, fontSize });
});

// Persistent storage for uploaded signature images - same directory the
// SQLite DB itself lives in, so it survives redeploys the same way the
// database already does.
const SIGNATURE_UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads", "signatures");
if (!fs.existsSync(SIGNATURE_UPLOAD_DIR)) fs.mkdirSync(SIGNATURE_UPLOAD_DIR, { recursive: true });

const SIGNATURE_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2MB, matching the client-side cap
const SIGNATURE_IMAGE_MIME_TO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const LOGO_UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads", "logos");
if (!fs.existsSync(LOGO_UPLOAD_DIR)) fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });

const LOGO_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2MB, as requested
// PNG/JPEG/WEBP/GIF cover the common web image formats - deliberately no
// SVG despite it being a common logo format elsewhere, since most email
// clients (Outlook especially) don't render SVG at all; an SVG logo
// would just show as a broken image in a real inbox.
const LOGO_IMAGE_MIME_TO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

// POST /api/settings/signature-image { dataUrl } -> { url }
// Accepts a base64 data URL (what FileReader.readAsDataURL produces
// client-side), decodes and saves it to disk, and returns a short URL to
// reference instead - this is what keeps the signature itself small
// (a `<img src="/uploads/signatures/abc123.png">` reference) rather than
// embedding the full base64 payload directly in the signature HTML.
router.post("/signature-image", (req, res) => {
  const { dataUrl } = req.body || {};
  const match = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Please upload a PNG, JPEG, or WEBP image." });

  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length > SIGNATURE_IMAGE_MAX_BYTES) {
    return res.status(400).json({ error: "Image is too large - please use one under 2MB." });
  }

  const ext = SIGNATURE_IMAGE_MIME_TO_EXT[mimeType];
  const filename = `${req.session.userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(SIGNATURE_UPLOAD_DIR, filename), buffer);

  res.json({ url: `/uploads/signatures/${filename}` });
});

// POST /api/settings/email-logo { dataUrl } -> { url }
// Same pattern as signature-image above, but this is the one logo used
// across every email template - saved to disk and referenced by path on
// the user's own row, not embedded inline.
router.post("/email-logo", (req, res) => {
  const { dataUrl } = req.body || {};
  const match = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Please upload a PNG, JPEG, GIF, or WEBP image." });

  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length > LOGO_IMAGE_MAX_BYTES) {
    return res.status(400).json({ error: "Image is too large - please use one under 2MB." });
  }

  const ext = LOGO_IMAGE_MIME_TO_EXT[mimeType];
  const filename = `${req.session.userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(LOGO_UPLOAD_DIR, filename), buffer);

  const url = `/uploads/logos/${filename}`;
  db.prepare("UPDATE users SET email_logo_path = ? WHERE id = ?").run(url, req.session.userId);
  res.json({ url });
});

// DELETE /api/settings/email-logo - removes the logo reference (file
// itself is left on disk rather than deleted, avoiding any risk of
// deleting something still referenced by an in-flight send).
router.delete("/email-logo", (req, res) => {
  db.prepare("UPDATE users SET email_logo_path = NULL WHERE id = ?").run(req.session.userId);
  res.json({ ok: true });
});

// GET /api/settings/email-templates -> all 10 presets, each with its
// merged settings (preset defaults + this user's customization, if
// any) and whether it's currently the account's default for sending.
router.get("/email-templates", (req, res) => {
  const userRow = db.prepare("SELECT default_email_template_key FROM users WHERE id = ?").get(req.session.userId);
  const customRows = db.prepare("SELECT template_key, settings FROM email_templates WHERE user_id = ?").all(req.session.userId);
  const customByKey = new Map(customRows.map((r) => [r.template_key, JSON.parse(r.settings)]));

  const templates = emailTemplates.TEMPLATE_PRESETS.map((preset) => ({
    key: preset.key,
    name: preset.name,
    description: preset.description,
    isDefault: preset.key === (userRow?.default_email_template_key || "minimal_branded"),
    isCustomized: customByKey.has(preset.key),
    settings: emailTemplates.mergeTemplateSettings(preset.key, customByKey.get(preset.key)),
  }));
  res.json({ templates, fonts: emailTemplates.EMAIL_TEMPLATE_FONTS.map((f) => ({ value: f.value, label: f.label })) });
});

// PUT /api/settings/email-templates/:key { settings: {...} } - saves a
// partial or full override on top of that template's own preset
// defaults. Only known, valid fields are accepted, so a malformed
// request can't inject arbitrary keys into what eventually gets
// interpolated into real HTML.
const VALID_TEMPLATE_SETTING_KEYS = Object.keys(emailTemplates.DEFAULT_TEMPLATE_SETTINGS);
router.put("/email-templates/:key", (req, res) => {
  const preset = emailTemplates.TEMPLATE_PRESETS.find((t) => t.key === req.params.key);
  if (!preset) return res.status(404).json({ error: "Unknown template" });

  const incoming = req.body?.settings || {};
  const sanitized = {};
  for (const k of VALID_TEMPLATE_SETTING_KEYS) {
    if (incoming[k] !== undefined) sanitized[k] = incoming[k];
  }
  // Font size and logo height are the only free-numeric fields - clamp
  // them to sane ranges so a bad value can't produce broken-looking HTML.
  if (sanitized.fontSize !== undefined) sanitized.fontSize = Math.max(10, Math.min(24, Number(sanitized.fontSize) || 14));
  if (sanitized.headerFontSize !== undefined) sanitized.headerFontSize = Math.max(8, Math.min(20, Number(sanitized.headerFontSize) || 12));
  if (sanitized.footerFontSize !== undefined) sanitized.footerFontSize = Math.max(8, Math.min(18, Number(sanitized.footerFontSize) || 11));
  if (sanitized.logoHeight !== undefined) sanitized.logoHeight = Math.max(16, Math.min(80, Number(sanitized.logoHeight) || 32));
  if (sanitized.fontFamily !== undefined && !emailTemplates.EMAIL_TEMPLATE_FONTS.some((f) => f.value === sanitized.fontFamily)) delete sanitized.fontFamily;
  if (sanitized.ctaStyle !== undefined && !["plain", "colored", "button"].includes(sanitized.ctaStyle)) delete sanitized.ctaStyle;

  const existing = db.prepare("SELECT settings FROM email_templates WHERE user_id = ? AND template_key = ?").get(req.session.userId, req.params.key);
  const merged = { ...(existing ? JSON.parse(existing.settings) : {}), ...sanitized };
  db.prepare(
    `INSERT INTO email_templates (user_id, template_key, settings, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, template_key) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`
  ).run(req.session.userId, req.params.key, JSON.stringify(merged));

  res.json({ settings: emailTemplates.mergeTemplateSettings(req.params.key, merged) });
});

// POST /api/settings/email-templates/:key/reset - drops back to the
// preset's own built-in defaults, discarding any customization.
router.post("/email-templates/:key/reset", (req, res) => {
  db.prepare("DELETE FROM email_templates WHERE user_id = ? AND template_key = ?").run(req.session.userId, req.params.key);
  res.json({ settings: emailTemplates.mergeTemplateSettings(req.params.key, null) });
});

// PUT /api/settings/default-email-template { templateKey } - which
// template every campaign actually sends with, automatically, unless
// something later overrides it per-send.
router.put("/default-email-template", (req, res) => {
  const { templateKey } = req.body || {};
  if (!emailTemplates.TEMPLATE_PRESETS.some((t) => t.key === templateKey)) return res.status(400).json({ error: "Unknown template" });
  db.prepare("UPDATE users SET default_email_template_key = ? WHERE id = ?").run(templateKey, req.session.userId);
  res.json({ defaultTemplateKey: templateKey });
});

// GET /api/settings/email-templates/:key/preview -> { html } - renders
// real sample content through the exact same function used for an
// actual send, so what's shown here is never a prettier stand-in for
// what a recipient actually gets.
router.get("/email-templates/:key/preview", (req, res) => {
  const preset = emailTemplates.TEMPLATE_PRESETS.find((t) => t.key === req.params.key);
  if (!preset) return res.status(404).json({ error: "Unknown template" });

  const userRow = db
    .prepare("SELECT signature, signature_font_family, signature_font_size, email_logo_path, facebook_link, instagram_link, linkedin_link, tiktok_link FROM users WHERE id = ?")
    .get(req.session.userId);
  const existing = db.prepare("SELECT settings FROM email_templates WHERE user_id = ? AND template_key = ?").get(req.session.userId, req.params.key);
  const { wrapSignatureWithFont, DEFAULT_SIGNATURE } = require("../outreachContent");

  const sampleBody = `Hi Sarah,\n\nI came across Rooftop Restorations while researching roofing companies in Austin, and noticed you've built up 140 five-star reviews without even having a website yet. That's a rare position to be in - most of your competitors are paying for ads to get the trust you've already earned for free.\n\nWorth a quick call this week to see what that could look like?`;

  const html = emailTemplates.renderEmailHtml({
    templateKey: req.params.key,
    customSettings: existing ? JSON.parse(existing.settings) : null,
    bodyText: sampleBody,
    signatureHtml: wrapSignatureWithFont(userRow?.signature || DEFAULT_SIGNATURE, userRow?.signature_font_family, userRow?.signature_font_size),
    universalLinks: {
      facebookLink: userRow?.facebook_link,
      instagramLink: userRow?.instagram_link,
      linkedinLink: userRow?.linkedin_link,
      tiktokLink: userRow?.tiktok_link,
    },
    logoUrl: userRow?.email_logo_path,
  });
  res.json({ html });
});

// GET /api/settings/ai-provider-preferences -> the default AI provider to
// pre-select for content generation and inspection separately (empty
// string means "Auto" / fallback chain). Per-generation choices in the UI
// still override this - it's just what gets pre-selected each time.
router.get("/ai-provider-preferences", (req, res) => {
  const row = db.prepare("SELECT preferred_content_provider, preferred_inspection_provider FROM users WHERE id = ?").get(req.session.userId);
  res.json({
    contentProvider: row?.preferred_content_provider || "",
    inspectionProvider: row?.preferred_inspection_provider || "",
  });
});

router.put("/ai-provider-preferences", (req, res) => {
  const VALID = ["", "groq", "gemini", "deepseek", "opencode"];
  const { contentProvider, inspectionProvider } = req.body || {};
  if (contentProvider !== undefined && !VALID.includes(contentProvider)) return res.status(400).json({ error: "Invalid contentProvider" });
  if (inspectionProvider !== undefined && !VALID.includes(inspectionProvider)) return res.status(400).json({ error: "Invalid inspectionProvider" });

  db.prepare(
    `UPDATE users SET
      preferred_content_provider = COALESCE(?, preferred_content_provider),
      preferred_inspection_provider = COALESCE(?, preferred_inspection_provider)
     WHERE id = ?`
  ).run(contentProvider ?? null, inspectionProvider ?? null, req.session.userId);

  const row = db.prepare("SELECT preferred_content_provider, preferred_inspection_provider FROM users WHERE id = ?").get(req.session.userId);
  res.json({ contentProvider: row.preferred_content_provider || "", inspectionProvider: row.preferred_inspection_provider || "" });
});

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

function toPublicRow(row) {
  return {
    id: row.id,
    label: row.label,
    masked: maskKey(row.key_value),
    active: !!row.is_active,
    requestsMade: row.requests_made || 0,
    leadsCaught: row.leads_caught || 0,
    createdAt: row.created_at,
  };
}

// Shared CRUD logic for a provider's API keys - both Google Places and
// Gemini keys go through the exact same save/test/activate/delete/list
// flow, just scoped to their own provider and their own key-testing
// function. Mounted twice below instead of duplicating this route set.
function createKeyRoutes(provider, testFn, envFallbackVar) {
  const sub = express.Router();

  sub.get("/", (req, res) => {
    const rows = apiKeys.listKeys(req.session.userId, provider).map(toPublicRow);
    const activeRow = rows.find((r) => r.active);
    const isAdmin = req.session.role === "admin";
    res.json({
      keys: rows,
      activeId: activeRow ? activeRow.id : null,
      envFallbackAvailable: envFallbackVar && isAdmin ? !!process.env[envFallbackVar] : false,
    });
  });

  sub.post("/test-value", asyncHandler(async (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ ok: false, error: "Enter an API key first." });
    }
    const result = await testFn(apiKey.trim());
    res.json(result);
  }));

  sub.post("/", asyncHandler(async (req, res) => {
    const { label, apiKey } = req.body || {};
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    const trimmedKey = apiKey.trim();
    const trimmedLabel = (label && label.trim()) || "Untitled key";

    const result = await testFn(trimmedKey);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || "Key test failed", tested: true });
    }

    const row = apiKeys.insertKey(req.session.userId, trimmedLabel, trimmedKey, provider);
    res.json(toPublicRow(row));
  }));

  sub.post("/:id/test", asyncHandler(async (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: "Key not found" });
    const result = await testFn(row.key_value);
    res.json(result);
  }));

  sub.post("/:id/activate", (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ error: "Key not found" });
    apiKeys.setActive(req.session.userId, row.id, provider);
    res.json({ ok: true, activeId: row.id });
  });

  sub.delete("/:id", (req, res) => {
    const row = apiKeys.getKeyById(req.session.userId, req.params.id);
    if (!row) return res.status(404).json({ error: "Key not found" });
    apiKeys.deleteKey(req.session.userId, row.id);
    res.json({ ok: true });
  });

  return sub;
}

// Google Places keys (existing behavior, paths unchanged: /api/settings/keys/...)
router.use("/keys", createKeyRoutes("google_places", testPlacesKey, "GOOGLE_PLACES_API_KEY"));

// Gemini keys (new: /api/settings/gemini-keys/...) - used for business
// deep-analysis and outreach content generation.
router.use("/gemini-keys", createKeyRoutes("gemini", testGeminiKey, null));

// Groq keys (new: /api/settings/groq-keys/...) and DeepSeek keys (new:
// /api/settings/deepseek-keys/...) - both used as fallback AI providers
// alongside Gemini for business analysis and content generation.
router.use("/groq-keys", createKeyRoutes("groq", groqClient.testApiKey, null));
router.use("/deepseek-keys", createKeyRoutes("deepseek", deepseekClient.testApiKey, null));

// OpenCode keys (new: /api/settings/opencode-keys/...) - an optional
// extra fallback provider, tried last in the chain.
router.use("/opencode-keys", createKeyRoutes("opencode", opencodeClient.testApiKey, null));

// GET /api/settings/usage-summary -> this month's usage totals for both
// providers, for the "Limits Usage" page.
router.get("/usage-summary", (req, res) => {
  const providers = ["google_places", "gemini", "groq", "deepseek", "opencode"];
  const result = {};
  for (const p of providers) {
    result[p] = apiKeys.currentMonthUsage(req.session.userId, p);
  }
  res.json(result);
});

// GET /api/settings/usage-history?provider=gemini|groq|deepseek|opencode|google_places
// -> all-time totals per key + a daily timeseries, same shape the Reports
// page's chart already uses, reused here for the Limits Usage page's
// per-provider charts (and embedded on each provider's own Settings page).
const USAGE_RANGE_DAYS = { "1d": 1, "7d": 7, "30d": 30, "60d": 60, "90d": 90, "1y": 365, all: null };

router.get("/usage-history", (req, res) => {
  const provider = ["google_places", "gemini", "groq", "deepseek", "opencode"].includes(req.query.provider) ? req.query.provider : "gemini";
  const range = USAGE_RANGE_DAYS.hasOwnProperty(req.query.range) ? req.query.range : "1d";
  const days = USAGE_RANGE_DAYS[range];

  const allTime = apiKeys.allTimeUsage(req.session.userId, provider);
  const daily = apiKeys.dailyUsageHistory(req.session.userId, days, provider);

  const dayLabels = Array.from(new Set(daily.map((d) => d.usage_date))).sort();
  const byKey = {};
  for (const row of allTime) {
    byKey[row.id] = {
      id: row.id,
      label: row.label,
      active: !!row.is_active,
      totalRequests: row.requests_made || 0,
      totalLeads: row.leads_caught || 0,
      requestsSeries: dayLabels.map(() => 0),
    };
  }
  daily.forEach((row) => {
    const entry = byKey[row.api_key_id];
    if (!entry) return;
    const dayIndex = dayLabels.indexOf(row.usage_date);
    if (dayIndex === -1) return;
    entry.requestsSeries[dayIndex] = row.requests_made || 0;
  });

  res.json({ days: dayLabels, keys: Object.values(byKey), range });
});

module.exports = router;
