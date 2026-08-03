const { generateWithFallback } = require("./aiProviders");
const db = require("./db");

// Ten palettes, each with clearly-labeled roles (background / primary /
// accent / dark) so they can be handed to the AI as "brand-authoritative"
// hex codes, exactly as the tested prompt expects when color_palette is
// provided. "surprise" is a special value meaning: don't pass a palette
// at all, let the AI pick one that fits the chosen style + industry.
const COLOR_PRESETS = {
  emerald: { label: "Emerald & Amber", swatch: ["#1B6B4F", "#E8A23D", "#FAFAF8"], roles: { background: "#FAFAF8", primary: "#1B6B4F", accent: "#E8A23D", dark: "#0F4A35" } },
  midnight: { label: "Midnight & Coral", swatch: ["#161A2B", "#FF6A57", "#F4F2ED"], roles: { background: "#F4F2ED", primary: "#161A2B", accent: "#FF6A57", dark: "#0A0C16" } },
  terracotta: { label: "Terracotta & Sand", swatch: ["#B5502F", "#D9B26A", "#FBF6EE"], roles: { background: "#FBF6EE", primary: "#B5502F", accent: "#D9B26A", dark: "#5C2E1A" } },
  ocean: { label: "Ocean & Citrus", swatch: ["#0E5C73", "#F2B441", "#F3FAFB"], roles: { background: "#F3FAFB", primary: "#0E5C73", accent: "#F2B441", dark: "#08404F" } },
  plum: { label: "Plum & Gold", swatch: ["#5B2A5E", "#D4A24E", "#F8F4F5"], roles: { background: "#F8F4F5", primary: "#5B2A5E", accent: "#D4A24E", dark: "#401C42" } },
  slate: { label: "Slate & Lime", swatch: ["#38424A", "#9BC53D", "#F5F6F5"], roles: { background: "#F5F6F5", primary: "#38424A", accent: "#9BC53D", dark: "#232A2F" } },
  rose: { label: "Rose & Charcoal", swatch: ["#2B2724", "#E8879B", "#FAF6F4"], roles: { background: "#FAF6F4", primary: "#2B2724", accent: "#E8879B", dark: "#1A1715" } },
  forest: { label: "Forest & Copper", swatch: ["#1E3B2C", "#C1703F", "#F5F3EC"], roles: { background: "#F5F3EC", primary: "#1E3B2C", accent: "#C1703F", dark: "#122419" } },
  electric: { label: "Electric & Ink", swatch: ["#0A0A0F", "#3ED0F0", "#161620"], roles: { background: "#0A0A0F", primary: "#F2F2F5", accent: "#3ED0F0", dark: "#000000" } },
  blush: { label: "Blush & Sage", swatch: ["#8CA187", "#F0C9C9", "#FBF8F5"], roles: { background: "#FBF8F5", primary: "#8CA187", accent: "#F0C9C9", dark: "#4A5A47" } },
  surprise: { label: "Surprise me (AI picks)", swatch: ["#CFCFCF", "#9C9C9C", "#6A6A6A"], roles: null },
};

// The 8 named design languages from the tested prompt - each a design
// language, not a niche; the business-specific flavor comes from the AI's
// choice of imagery/icons/signature element, not from picking a different
// style per industry.
const DESIGN_STYLES = {
  minimal: { label: "Minimal", description: "Generous whitespace, one accent color, oversized stat as hero anchor" },
  modern: { label: "Modern", description: "Glassmorphism cards, gradient-mesh backgrounds, a floating live-data card" },
  creative: { label: "Creative / Bold", description: "Asymmetric grids, oversized type, hover-reveal gallery" },
  elegant: { label: "Elegant / Luxe", description: "Serif display type, editorial photography, understated reveal" },
  organic: { label: "Organic / Warm", description: "Earthy palette, hand-drawn dividers, a curved flow graphic" },
  corporate: { label: "Corporate / Professional", description: "Structured grid, trust badges, a dispatch-ticket style hero card" },
  playful: { label: "Playful", description: "Bright accents, rounded blobs, sticker-style callouts" },
  dark: { label: "Dark / Gallery", description: "Near-black canvas, vivid accent, poster-style type, portfolio grid" },
};

function slugifyPart(text) {
  return (
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "site"
  );
}

// Base slug has no random suffix, per spec - readable, predictable URLs.
// Collision handling (appending -2, -3, ...) happens separately in
// resolveUniqueSlug, once the caller knows this exact base is taken.
function buildBaseSlug(niche, city, businessName) {
  return [slugifyPart(niche), slugifyPart(city), slugifyPart(businessName)].filter(Boolean).join("/");
}

function resolveUniqueSlug(baseSlug) {
  const existing = db.prepare("SELECT slug FROM generated_sites WHERE slug = ? OR slug LIKE ?").all(baseSlug, `${baseSlug}-%`);
  if (existing.length === 0) return baseSlug;
  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(baseSlug)) return baseSlug; // the exact base is free, only numbered variants exist
  let n = 2;
  while (taken.has(`${baseSlug}-${n}`)) n++;
  return `${baseSlug}-${n}`;
}

// The stable "role" half of the prompt - the full system prompt supplied
// and already tested by the user, kept verbatim so the validated behavior
// carries over exactly. Only the business-specific context block (below)
// changes per generation.
const SYSTEM_PROMPT = `## ROLE

You are a senior conversion-focused web designer/developer working for **Xeven Pixels**, an agency that builds custom landing pages for client businesses. For every request, you will receive structured business info and must output ONE complete, self-contained, production-ready HTML file — fully responsive, visually distinctive, and built for lead conversion.

You never ship a generic template. Every page must feel custom-designed for that specific business.

## NAMED STYLE LIBRARY

Pick the ONE named style given to you in the business info below. Each style is a design language, not a niche - the niche-specific flavor comes from imagery, icon choices, and one signature element you design fresh for that business.

- **Minimal**: Generous whitespace, monochrome base + exactly one accent color, thin/light sans-serif display type, no heavy shadows, subtle micro-interactions only. Signature move: a single oversized statistic or line of copy as the hero's visual anchor instead of a graphic.
- **Modern**: Geometric sans display type, soft gradient-mesh or blurred-blob background accents, glassmorphism cards (translucent, blurred backdrops), rounded-corner UI elements. Signature move: a floating "live" UI card in the hero (dashboard-style stat, live status, or booking widget) - pick a data point real to the business.
- **Creative / Bold**: Asymmetric grids, oversized display type (often uppercase), high-contrast duotone palette, masonry or broken-grid image layouts. Signature move: an interactive hover-reveal gallery/grid relevant to the business's actual work.
- **Elegant / Luxe**: Serif display type paired with a refined sans body, muted/jewel-tone or neutral+metallic accent palette, large editorial-style photography, lots of breathing room. Signature move: a slow, understated reveal element (e.g. a thin gold divider line, a subtle badge) - never loud.
- **Organic / Warm**: Earthy palette (clay, sand, sage, olive, terracotta), rounded soft shapes, hand-drawn-style wave/arc dividers instead of hard lines. Signature move: a curved SVG divider or radial "flow" graphic that echoes the business's rhythm (a schedule, a process, a cycle).
- **Corporate / Professional**: Structured grid, navy/charcoal base + one confident accent, spec-sheet-style comparison blocks for "why choose us," trust-badge rows. Signature move: a "live ticket/dispatch/dashboard" card in the hero that mimics a real internal document from that trade (a work order, an invoice, a claim form).
- **Playful**: Bright multi-color accents, rounded blob shapes, sticker/badge-style callouts, a friendly rounded sans typeface. Signature move: small animated or illustrated mascot-style icons (never real people rendered as cartoons - use abstract shapes/objects relevant to the business).
- **Dark / Gallery**: Near-black canvas background, one or two vivid accent colors, heavy poster-style uppercase display type, high contrast. Signature move: an interactive portfolio/work masonry grid with hover captions.

If told to pick freely, choose the style whose signature move most naturally fits a real object/ritual/document from that specific industry.

## FIXED PAGE STRUCTURE (always include, in this order)

1. Sticky header - logo/business name, nav links to each section, phone or key contact chip (desktop only), primary CTA button, and a working hamburger menu on mobile (see Technical Rules).
2. Hero - headline + subhead covering the core offer, primary + secondary CTA, trust row (avatar stack + a number), one hero visual (real image + one signature graphic/floating card per the chosen style).
3. About - who the business is, story/credibility, 3 short trust bullet points, one supporting image.
4. Services - grid of the business's actual services, each with an icon, short benefit-driven description, and a micro-CTA link.
5. Why Choose Us - 4-card spec/benefit grid answering the objection a lead would actually have before buying.
6. Social Proof strip - 4-5 hard numbers (years in business, clients served, rating, response time, etc.)
7. Reviews - 3 testimonials with star rating, short quote, name + context. Generate realistic, industry-appropriate placeholders and mark them clearly as placeholders.
8. Case Studies / Recent Work - 3 cards with a tag, short result-driven story, and 2 hard numbers each.
9. Lead Form - split layout: left = reassurance copy + 3 bullet points; right = form (name, phone/email, service dropdown, message) with a clear CTA button.
10. Footer - brand blurb + social icons, nav column, services column, legal/policy column (Privacy, Terms, and 1-2 industry-relevant policy links), bottom bar with copyright and the line "Crafted by Xeven Pixels".

Together, sections 2-9 must implicitly answer the 5 Ws: Who (About), What (Services), Why (Why Choose Us + Reviews), Where/When (Contact details, hours, footer), How to act now (CTA + Lead Form).

## HARD TECHNICAL RULES - never skip these, they were learned from real bugs

1. No CSS class-name collisions. Never reuse a generic class name (like .lead, .info, .card) for both a section wrapper and an inner text element. Namespace section-specific classes (.hero-copy, .about-copy, .book-copy).
2. No overlapping elements, at any breakpoint. Any floating/absolutely-positioned card must sit with positive insets clamped inside its parent container, never with negative offsets that hang outside the container. Check the layout mentally at 1440px, 980px, and 375px.
3. No horizontal overflow. body { overflow-x: hidden; } is a safety net, not a fix - the real fix is rule #2. Every grid must collapse to fewer columns at 980px and 600px breakpoints.
4. Fully working mobile navigation. Nav links must hide below ~980px and a hamburger button must toggle a slide-down panel containing all nav links + contact info + the primary CTA, via real JS (classList.toggle), not just CSS :hover. Auto-close the panel when a link is tapped.
5. Real, relevant images - reliably loading. Use https://loremflickr.com/{width}/{height}/{comma-separated-keywords}?lock={unique-number} for photographic imagery, with keywords derived from the business's actual industry/services. Give every <img> a descriptive, accurate alt attribute. Never use source.unsplash.com or guess Unsplash CDN photo IDs.
6. All icons/graphics as inline SVG. No external icon-font dependencies. Icons must visually match what they represent.
7. Distinct typography per project. Pick a display/body Google Font pairing that fits the chosen style.
8. Accessible basics. Sufficient color contrast, one h1 in the hero, h2 per section, focusable interactive elements, alt text on all images, aria-label on icon-only buttons.
9. Sensitive-industry content care. For healthcare, mental health, fitness/body, and finance clients: keep testimonials and case studies framed around process/consistency/outcomes in general terms - no specific clinical claims, no diagnosis language, no before/after body-image framing, no guaranteed-results language.
10. One self-contained file. All CSS and JS inline in a single HTML file. No build step, no external JS framework dependency beyond Google Fonts.

## OUTPUT

Respond with ONLY the complete HTML file, starting with <!DOCTYPE html> and ending with </html>. No markdown code fences, no commentary before or after, no explanation of your choices - just the raw HTML file content.`;

function buildBusinessContextBlock(ctx) {
  const lines = [
    `business_name: ${ctx.businessName}`,
    `industry: ${ctx.niche}`,
    `location: ${ctx.city}`,
    `style_preference: ${DESIGN_STYLES[ctx.designStyle]?.label || "surprise me"}`,
  ];
  if (ctx.services) lines.push(`services: ${ctx.services}`);
  if (ctx.ctaGoal) lines.push(`cta_goal: ${ctx.ctaGoal}`);
  if (ctx.phone) lines.push(`contact_phone: ${ctx.phone}`);
  if (ctx.address) lines.push(`contact_address: ${ctx.address}`);
  if (ctx.socials && Object.keys(ctx.socials).length) {
    lines.push(`social_handles: ${Object.entries(ctx.socials).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }
  if (ctx.strengths) lines.push(`known_strengths (use these for About/Why Choose Us, don't invent contradicting facts): ${ctx.strengths}`);

  const preset = ctx.colorPreset && ctx.colorPreset !== "surprise" ? COLOR_PRESETS[ctx.colorPreset] : null;
  if (preset) {
    lines.push(
      `color_palette (brand-authoritative - derive the style's tokens from these, do not substitute your own): background ${preset.roles.background}, primary ${preset.roles.primary}, accent ${preset.roles.accent}, dark ${preset.roles.dark}`
    );
  } else {
    lines.push(`color_palette: not provided - choose one that fits the style and industry`);
  }

  lines.push(`\nFooter must read "Crafted by Xeven Pixels" and link to https://xevenpixels.com`);

  return lines.join("\n");
}

async function generateFullPage(userId, ctx) {
  const prompt = `${SYSTEM_PROMPT}\n\n## BUSINESS INFO FOR THIS REQUEST\n\n${buildBusinessContextBlock(ctx)}`;
  // A full 10-section page with inline SVGs/CSS/JS is a much bigger,
  // slower generation than a short copy snippet - both the timeout and
  // the token budget need real headroom. Safe to go long here since this
  // always runs inside the async job runner, never blocking the
  // browser-facing request.
  const result = await generateWithFallback(userId, prompt, { timeoutMs: 90000, maxTokens: 12000 });
  if (!result.ok) return result;

  let html = result.text.trim();
  // Strip markdown code fences if the model wrapped its output despite
  // being told not to - a cheap, harmless safety net.
  html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  if (!/<!DOCTYPE html>/i.test(html)) {
    return { ok: false, error: "AI response didn't look like a complete HTML page - try again." };
  }

  return { ok: true, html, provider: result.provider };
}

module.exports = {
  COLOR_PRESETS,
  DESIGN_STYLES,
  buildBaseSlug,
  resolveUniqueSlug,
  buildBusinessContextBlock,
  generateFullPage,
};
