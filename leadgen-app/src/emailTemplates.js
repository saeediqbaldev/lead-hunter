// The 10-template email system. Every template shares the exact same
// settings schema (font, colors, header, footer, accent styling) - a
// "template" is really just a named starting point for that schema, not
// a hardcoded, one-off design. This is what makes "each and every field
// fully editable" actually true for all 10 at once: customizing font
// size on template 3 uses the same code path as customizing it on
// template 7.
//
// The renderer below is deliberately old-fashioned HTML: nested tables,
// inline styles on every element, no <style> block, no flexbox/grid, no
// CSS media queries relied on for correctness. That's not a stylistic
// choice - it's the only layout approach that survives Outlook desktop
// (which renders HTML email using Word's engine, not a browser engine)
// alongside Gmail, Apple Mail, and everything else. A single-column,
// fluid table (width=100% attribute + max-width in the style) is what
// makes this responsive on a phone without needing @media queries that
// Outlook ignores anyway.
const { SIGNATURE_FONTS } = require("./signatureFonts");

// Two serif options added on top of the signature system's 10 - two of
// the ten templates below call for a serif body font (Understated
// Serif, Formal/Corporate), which the signature font list never needed
// before. Georgia is web-safe (every device already has it, no Google
// Fonts import needed); Merriweather is a genuinely nice serif for a
// more considered look, with its own Google Fonts import like the rest.
const EMAIL_TEMPLATE_FONTS = [
  ...SIGNATURE_FONTS,
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia", googleFont: null },
  { value: "'Merriweather', serif", label: "Merriweather", googleFont: "Merriweather:wght@400;700" },
];

const DEFAULT_TEMPLATE_SETTINGS = {
  fontFamily: "'Poppins', sans-serif",
  fontSize: 14,
  textColor: "#222222",
  backgroundColor: "#ffffff",
  accentColor: "#3B6EE0",
  showLogo: true,
  logoHeight: 32,
  headerText: "",
  headerFontSize: 12,
  headerColor: "#666666",
  headerBandColor: "", // empty = no band (today's plain top); a hex value renders a full-width colored strip behind the logo/header, with light/reversed text
  cardShadow: false,
  cardRadius: 10,
  showAccentBar: false,
  showDivider: true,
  ctaText: "Book a free call",
  ctaStyle: "plain", // 'plain' | 'colored' | 'button' - how the CTA link renders, when one is set in universal links
  showSocialIcons: true,
  footerText: "",
  footerFontSize: 11,
  footerColor: "#999999",
};

// Ten starting points, each just a partial override of the schema above
// - every field not listed here still exists and is still editable, it
// just inherits the neutral default until someone changes it.
const TEMPLATE_PRESETS = [
  {
    key: "personal_plus",
    name: "Personal Plus",
    description: "Closest to writing it yourself - generous spacing, no color, no logo emphasis. The safest option for a first-touch cold email.",
    defaults: { showLogo: false, showAccentBar: false, accentColor: "#666666", showSocialIcons: false, cardRadius: 0 },
  },
  {
    key: "clean_professional",
    name: "Clean Professional",
    description: "A softly elevated card with one refined accent color on the signature and a hairline divider. Nothing else colored.",
    defaults: { accentColor: "#2F5FD6", showAccentBar: false, cardShadow: true, cardRadius: 14 },
  },
  {
    key: "understated_serif",
    name: "Understated Serif",
    description: "A serif body font and squared-off corners read as a considered, printed letter rather than a template.",
    defaults: { fontFamily: "Georgia, 'Times New Roman', serif", showLogo: false, accentColor: "#8A6D3B", cardRadius: 2 },
  },
  {
    key: "soft_accent_bar",
    name: "Soft Accent Bar",
    description: "A colored edge on a gently floating card - distinctive without a single word of the message looking different.",
    defaults: { showAccentBar: true, accentColor: "#E63329", cardShadow: true, cardRadius: 10 },
  },
  {
    key: "confident_cta",
    name: "Confident CTA",
    description: "Otherwise plain, but the call-to-action renders as a real, unmistakable button instead of a bare line.",
    defaults: { showLogo: false, ctaStyle: "button", accentColor: "#2F5FD6", cardShadow: true, cardRadius: 12 },
  },
  {
    key: "minimal_branded",
    name: "Minimal Branded",
    description: "The logo sits on its own soft-tinted band at the top - present without looking like a marketing banner.",
    defaults: { showLogo: true, accentColor: "#3B6EE0", headerBandColor: "#EEF3FF", headerColor: "#3B6EE0", cardRadius: 12 },
  },
  {
    key: "warm_neutral",
    name: "Warm Neutral",
    description: "An off-white, cream-toned background with soft, rounded corners - a warmer, cozier feel.",
    defaults: { backgroundColor: "#FAF7F2", accentColor: "#B08050", cardRadius: 18 },
  },
  {
    key: "tight_modern",
    name: "Tight & Modern",
    description: "A bold, full-width colored header band with a contemporary sans font - feels like a current SaaS product, not a cold email.",
    defaults: {
      fontFamily: "'Inter', sans-serif",
      fontSize: 13.5,
      showLogo: true,
      accentColor: "#1D9E75",
      headerBandColor: "#0F2E24",
      cardShadow: true,
      cardRadius: 8,
    },
  },
  {
    key: "formal_corporate",
    name: "Formal / Corporate",
    description: "A deep navy letterhead band, traditional serif, and sharp corners - a fit for law, finance, and traditional industries.",
    defaults: {
      fontFamily: "Georgia, 'Times New Roman', serif",
      showLogo: true,
      accentColor: "#1F3A5F",
      headerBandColor: "#1F3A5F",
      showSocialIcons: false,
      cardRadius: 0,
    },
  },
  {
    key: "founder_note",
    name: "Founder Note",
    description: "No accent color, no shadow, sharp corners - just typography and whitespace, designed to feel like it came directly from a founder.",
    defaults: { showLogo: false, showAccentBar: false, accentColor: "#444444", showSocialIcons: false, showDivider: false, cardRadius: 0 },
  },
];

function getPresetByKey(key) {
  return TEMPLATE_PRESETS.find((t) => t.key === key) || TEMPLATE_PRESETS[0];
}

function mergeTemplateSettings(templateKey, customSettings) {
  const preset = getPresetByKey(templateKey);
  return { ...DEFAULT_TEMPLATE_SETTINGS, ...preset.defaults, ...(customSettings || {}) };
}

// Small inline SVGs, one per platform - simple enough to stay under a
// few hundred bytes each, since these get embedded directly in the
// email HTML rather than hosted as separate image files. Worth being
// upfront: inline SVG renders fine in Gmail, Apple Mail, and most
// clients, but Outlook desktop (which uses Word's rendering engine, not
// a browser engine) does not render SVG at all - it'll just show empty
// space there. Each icon is still wrapped in a real <a href>, so even
// where the icon itself doesn't render, the clickable link underneath
// it does.
const SOCIAL_ICON_PATHS = {
  facebook: "M17 2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
  instagram:
    "M8 2h8a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6zm8 2H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4zm-4 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z",
  linkedin:
    "M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM3.5 8.5h3.9V21H3.5V8.5zm6.5 0h3.7v1.7h.05c.52-.98 1.78-2 3.66-2 3.9 0 4.63 2.57 4.63 5.9V21h-3.9v-6.06c0-1.44-.03-3.3-2.01-3.3-2.02 0-2.33 1.58-2.33 3.2V21h-3.9V8.5z",
  tiktok:
    "M16.5 2h-3.2v13.3a2.6 2.6 0 1 1-2.6-2.7c.24 0 .48.03.7.08V9.4a6 6 0 1 0 5.1 5.9V8.6a7.6 7.6 0 0 0 4.5 1.5V6.9a4.3 4.3 0 0 1-4.5-4.9z",
};

function socialIconSvg(platform, color, size = 20) {
  const path = SOCIAL_ICON_PATHS[platform];
  if (!path) return "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;"><path d="${path}" fill="${color}"/></svg>`;
}

// Splits on blank lines (the AI's own paragraph breaks) into real <p>
// tags, and turns a single newline within a paragraph into a <br> -
// email clients don't collapse whitespace the way browsers do by
// default, so without this the AI's line breaks would either vanish or
// render as literal blank space depending on the client.
const URL_PATTERN = /(https?:\/\/[^\s<>")]+)/g;

// Splits into paragraphs on blank lines, HTML-escapes the content (a
// raw "&" or "<" in AI-generated text would otherwise corrupt the
// markup), and turns a single newline into a <br>. When a linkRewriter
// is given, any raw URL found in the text is passed through it and
// turned into a real <a> tag - this is how campaign-sending code hooks
// click-tracking into a template-rendered email without this module
// needing to know anything about how tracking links are built.
function paragraphsFromText(text, settings, linkRewriter) {
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let escaped = escapeHtml(p).replace(/\n/g, "<br>");
      if (linkRewriter) {
        escaped = escaped.replace(URL_PATTERN, (url) => {
          const trailingMatch = url.match(/[.,;:!?)\]]+$/);
          const trailing = trailingMatch ? trailingMatch[0] : "";
          const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
          return `<a href="${escapeAttr(linkRewriter(cleanUrl))}">${cleanUrl}</a>${trailing}`;
        });
      }
      return `<p style="margin:0 0 14px; font-family:${settings.fontFamily}; font-size:${settings.fontSize}px; line-height:1.65; color:${settings.textColor};">${escaped}</p>`;
    })
    .join("\n");
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The actual HTML that gets sent - and, rendered inside a preview
// frame, the exact same HTML shown while customizing a template in
// Settings. Using one function for both is deliberate: a separate,
// prettier preview-only version would risk drifting from what actually
// gets sent, which is a worse failure mode than a plain preview.
function renderEmailHtml({ templateKey, customSettings, bodyText, signatureHtml, universalLinks = {}, logoUrl, linkRewriter }) {
  const s = mergeTemplateSettings(templateKey, customSettings);
  const { facebookLink, instagramLink, linkedinLink, tiktokLink, ctaLink } = universalLinks;

  const logoImgHtml = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" height="${s.logoHeight}" style="height:${s.logoHeight}px; width:auto; display:block; border:0;" alt="Logo">`
    : "";

  // A header band is a real full-width colored strip behind the
  // logo/header text, structurally distinct from the plain white top
  // every template used to share - not just a color swapped in.
  let bandHtml = "";
  if (s.headerBandColor) {
    const bandLogo = s.showLogo && logoImgHtml ? `<div style="margin-bottom:${s.headerText ? "6px" : "0"};">${logoImgHtml}</div>` : "";
    const bandText = s.headerText
      ? `<p style="margin:0; font-family:${s.fontFamily}; font-size:${s.headerFontSize}px; color:#ffffff; opacity:0.9;">${escapeHtml(s.headerText)}</p>`
      : "";
    if (bandLogo || bandText) {
      bandHtml = `<div style="background:${s.headerBandColor}; padding:22px 30px; text-align:${s.showAccentBar ? "left" : "center"};">${bandLogo}${bandText}</div>`;
    }
  }

  // No band - logo/header render inline at the top of the regular
  // content area instead, exactly as before this rework.
  let inlineHeaderHtml = "";
  if (!bandHtml) {
    if (s.showLogo && logoImgHtml) inlineHeaderHtml += `<div style="margin-bottom:${s.headerText ? "8px" : "22px"};">${logoImgHtml}</div>`;
    if (s.headerText) {
      inlineHeaderHtml += `<p style="margin:0 0 22px; font-family:${s.fontFamily}; font-size:${s.headerFontSize}px; color:${s.headerColor};">${escapeHtml(s.headerText)}</p>`;
    }
  }

  const bodyHtml = paragraphsFromText(bodyText, s, linkRewriter);

  // The CTA link is a distinct, account-level link (e.g. a booking
  // page) - separate from anything the AI wrote, and separate from the
  // signature. Rendered here, between the body and the signature, only
  // when one is actually set.
  let ctaHtml = "";
  if (ctaLink) {
    const href = escapeAttr(linkRewriter ? linkRewriter(ctaLink) : ctaLink);
    const label = escapeHtml(s.ctaText || "Learn more");
    if (s.ctaStyle === "button") {
      ctaHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr>
        <td style="background:${s.accentColor}; border-radius:6px;">
          <a href="${href}" style="display:inline-block; padding:11px 22px; font-family:${s.fontFamily}; font-size:${s.fontSize}px; font-weight:600; color:#ffffff; text-decoration:none;">${label}</a>
        </td>
      </tr></table>`;
    } else {
      const color = s.ctaStyle === "colored" ? s.accentColor : s.textColor;
      ctaHtml = `<p style="margin:0 0 20px;"><a href="${href}" style="font-family:${s.fontFamily}; font-size:${s.fontSize}px; font-weight:${s.ctaStyle === "colored" ? "600" : "normal"}; color:${color}; text-decoration:underline;">${label}</a></p>`;
    }
  }

  const socialLinks = [
    { url: facebookLink, key: "facebook" },
    { url: instagramLink, key: "instagram" },
    { url: linkedinLink, key: "linkedin" },
    { url: tiktokLink, key: "tiktok" },
  ].filter((l) => l.url);
  let socialHtml = "";
  if (s.showSocialIcons && socialLinks.length) {
    const cells = socialLinks
      .map((l) => {
        const href = linkRewriter ? linkRewriter(l.url) : l.url;
        return `<td style="padding-right:10px;"><a href="${escapeAttr(href)}" style="text-decoration:none;">${socialIconSvg(l.key, s.accentColor)}</a></td>`;
      })
      .join("");
    socialHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>${cells}</tr></table>`;
  }

  const footerTextHtml = s.footerText
    ? `<p style="margin:12px 0 0; font-family:${s.fontFamily}; font-size:${s.footerFontSize}px; color:${s.footerColor};">${escapeHtml(s.footerText)}</p>`
    : "";

  const belowDivider = `${signatureHtml || ""}${socialHtml}${footerTextHtml}`;
  const dividerHtml = s.showDivider
    ? `<div style="border-top:1px solid #eeeeee; margin-top:18px; padding-top:18px;">${belowDivider}</div>`
    : `<div style="margin-top:18px;">${belowDivider}</div>`;

  const innerContent = `${inlineHeaderHtml}${bodyHtml}${ctaHtml}${dividerHtml}`;

  // The accent bar (when enabled) is a separate table cell, not a CSS
  // border - a real colored cell survives every email client, where a
  // border-left combined with rounded corners is the kind of thing that
  // renders inconsistently across them.
  const contentCell = s.showAccentBar
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
         <td width="4" style="background:${s.accentColor}; font-size:0; line-height:0;">&nbsp;</td>
         <td style="padding:32px 28px 32px 24px;">${innerContent}</td>
       </tr></table>`
    : `<div style="padding:32px 30px;">${innerContent}</div>`;

  const shadowStyle = s.cardShadow ? " box-shadow:0 6px 24px rgba(0,0,0,0.10);" : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.backgroundColor};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background:#ffffff; border-radius:${s.cardRadius}px; overflow:hidden;${shadowStyle}">
        ${bandHtml ? `<tr><td>${bandHtml}</td></tr>` : ""}
        <tr>
          <td>${contentCell}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

const VALID_TEMPLATE_SETTING_KEYS = Object.keys(DEFAULT_TEMPLATE_SETTINGS);
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COLOR_FIELDS = ["textColor", "backgroundColor", "accentColor", "headerColor", "footerColor"];

// Shared between the save route and the live-preview-draft route, so a
// value that wouldn't be trusted for a real save is never trusted for a
// preview either - only known setting keys pass through at all, numeric
// fields are clamped to sane ranges, colors must be real hex values, and
// free-choice fields (font, CTA style) must match an actual known option.
function sanitizeTemplateSettings(incoming) {
  const sanitized = {};
  for (const k of VALID_TEMPLATE_SETTING_KEYS) {
    if (incoming[k] !== undefined) sanitized[k] = incoming[k];
  }
  if (sanitized.fontSize !== undefined) sanitized.fontSize = Math.max(10, Math.min(24, Number(sanitized.fontSize) || 14));
  if (sanitized.headerFontSize !== undefined) sanitized.headerFontSize = Math.max(8, Math.min(20, Number(sanitized.headerFontSize) || 12));
  if (sanitized.footerFontSize !== undefined) sanitized.footerFontSize = Math.max(8, Math.min(18, Number(sanitized.footerFontSize) || 11));
  if (sanitized.logoHeight !== undefined) sanitized.logoHeight = Math.max(16, Math.min(80, Number(sanitized.logoHeight) || 32));
  if (sanitized.cardRadius !== undefined) sanitized.cardRadius = Math.max(0, Math.min(24, Number(sanitized.cardRadius) || 0));
  if (sanitized.cardShadow !== undefined) sanitized.cardShadow = !!sanitized.cardShadow;
  if (sanitized.fontFamily !== undefined && !EMAIL_TEMPLATE_FONTS.some((f) => f.value === sanitized.fontFamily)) delete sanitized.fontFamily;
  if (sanitized.ctaStyle !== undefined && !["plain", "colored", "button"].includes(sanitized.ctaStyle)) delete sanitized.ctaStyle;
  for (const field of COLOR_FIELDS) {
    if (sanitized[field] !== undefined && !HEX_COLOR_RE.test(sanitized[field])) delete sanitized[field];
  }
  // headerBandColor is the one color field allowed to be empty (meaning
  // "no band") - validated separately from the required-color fields above.
  if (sanitized.headerBandColor !== undefined && sanitized.headerBandColor !== "" && !HEX_COLOR_RE.test(sanitized.headerBandColor)) {
    delete sanitized.headerBandColor;
  }
  // headerText/footerText pass through as raw strings here - they're
  // escaped at render time (see escapeHtml above), not at save time, so
  // the stored value always matches exactly what was typed.
  return sanitized;
}

module.exports = {
  EMAIL_TEMPLATE_FONTS,
  DEFAULT_TEMPLATE_SETTINGS,
  TEMPLATE_PRESETS,
  getPresetByKey,
  mergeTemplateSettings,
  sanitizeTemplateSettings,
  renderEmailHtml,
  paragraphsFromText,
  socialIconSvg,
};
