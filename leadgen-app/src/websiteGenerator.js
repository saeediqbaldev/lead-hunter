const { generateWithFallback } = require("./aiProviders");

// Five palettes, each a full set of CSS custom property values. Templates
// reference these variable names - swapping the preset never touches the
// template's HTML/layout, only these values, so any style can pair with
// any palette.
const COLOR_PRESETS = {
  emerald: {
    label: "Emerald & Amber",
    swatch: ["#1B6B4F", "#E8A23D", "#FAFAF8"],
    vars: {
      "--bg": "#FAFAF8",
      "--surface": "#FFFFFF",
      "--ink": "#14201C",
      "--ink-muted": "#5B6B63",
      "--primary": "#1B6B4F",
      "--primary-dark": "#0F4A35",
      "--accent": "#E8A23D",
      "--border": "#E2E4DE",
    },
  },
  midnight: {
    label: "Midnight & Coral",
    swatch: ["#161A2B", "#FF6A57", "#F4F2ED"],
    vars: {
      "--bg": "#F4F2ED",
      "--surface": "#FFFFFF",
      "--ink": "#161A2B",
      "--ink-muted": "#5C6178",
      "--primary": "#161A2B",
      "--primary-dark": "#0A0C16",
      "--accent": "#FF6A57",
      "--border": "#E7E4DB",
    },
  },
  terracotta: {
    label: "Terracotta & Sand",
    swatch: ["#B5502F", "#D9B26A", "#FBF6EE"],
    vars: {
      "--bg": "#FBF6EE",
      "--surface": "#FFFFFF",
      "--ink": "#3A2A20",
      "--ink-muted": "#8A7768",
      "--primary": "#B5502F",
      "--primary-dark": "#8A3A20",
      "--accent": "#D9B26A",
      "--border": "#EDE2D0",
    },
  },
  ocean: {
    label: "Ocean & Citrus",
    swatch: ["#0E5C73", "#F2B441", "#F3FAFB"],
    vars: {
      "--bg": "#F3FAFB",
      "--surface": "#FFFFFF",
      "--ink": "#0C2530",
      "--ink-muted": "#5C7681",
      "--primary": "#0E5C73",
      "--primary-dark": "#08404F",
      "--accent": "#F2B441",
      "--border": "#DCEDF0",
    },
  },
  plum: {
    label: "Plum & Gold",
    swatch: ["#5B2A5E", "#D4A24E", "#F8F4F5"],
    vars: {
      "--bg": "#F8F4F5",
      "--surface": "#FFFFFF",
      "--ink": "#2B1A2D",
      "--ink-muted": "#7A6B7C",
      "--primary": "#5B2A5E",
      "--primary-dark": "#401C42",
      "--accent": "#D4A24E",
      "--border": "#EBE0EB",
    },
  },
  slate: {
    label: "Slate & Lime",
    swatch: ["#38424A", "#9BC53D", "#F5F6F5"],
    vars: {
      "--bg": "#F5F6F5",
      "--surface": "#FFFFFF",
      "--ink": "#20272B",
      "--ink-muted": "#657078",
      "--primary": "#38424A",
      "--primary-dark": "#232A2F",
      "--accent": "#9BC53D",
      "--border": "#E4E7E3",
    },
  },
};

const DESIGN_STYLES = {
  modern: { label: "Modern", description: "Bold serif headlines, confident color band, asymmetric layout" },
  minimal: { label: "Minimal", description: "Generous whitespace, quiet typography, understated" },
  standard: { label: "Standard", description: "Warm and approachable, conventional trust-first layout" },
};

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function generateSlug(niche, city, businessName) {
  const shortId = Math.random().toString(36).slice(2, 8);
  const parts = [slugify(niche), slugify(city), slugify(businessName)].filter(Boolean);
  return `${parts.join("/")}/${shortId}`;
}

// Each key is one section of the page. Prompts are deliberately narrow -
// one section's copy at a time - so a single provider failure only costs
// one section's retry, not the whole page, matching the same pattern
// already used for outreach content generation.
const SECTION_PROMPTS = {
  hero: (ctx) =>
    `Write hero copy for a landing page for "${ctx.businessName}", a ${ctx.niche} business in ${ctx.city}.
Return ONLY a JSON object (no markdown fences): {"headline": "...", "subheadline": "..."}
Headline: under 8 words, confident, specific to what this business does - not generic ("Grow Your Business").
Subheadline: one sentence, under 20 words, says what they do and for whom.`,

  about: (ctx) =>
    `Write a short "About" section for "${ctx.businessName}", a ${ctx.niche} business in ${ctx.city}.${ctx.strengths ? `\nKnown strengths: ${ctx.strengths}` : ""}
Return ONLY JSON: {"heading": "...", "body": "..."}
Heading: under 6 words. Body: 2-3 sentences, warm and specific, no generic filler like "We are passionate about excellence."`,

  services: (ctx) =>
    `List the 3-4 core services a ${ctx.niche} business like "${ctx.businessName}" would offer.
Return ONLY JSON: {"heading": "...", "items": [{"title": "...", "description": "..."}]}
Heading: under 6 words. Each item title: 2-4 words. Each description: one sentence, under 15 words.`,

  whyUs: (ctx) =>
    `Write a "Why choose us" section for "${ctx.businessName}", a ${ctx.niche} business.${ctx.weaknesses ? `\n(Frame these as strengths to lean into, don't mention the negatives directly: ${ctx.weaknesses})` : ""}
Return ONLY JSON: {"heading": "...", "points": ["...", "...", "..."]}
Heading: under 6 words. 3 points, each under 10 words, each a genuine, specific reason to choose this business.`,

  testimonial: (ctx) =>
    `Write one realistic-sounding customer testimonial for a ${ctx.niche} business called "${ctx.businessName}" in ${ctx.city}. This is a PLACEHOLDER for the business owner to replace with a real review later - make that obvious from context but keep it natural sounding.
Return ONLY JSON: {"quote": "...", "author": "..."}
Quote: under 30 words, specific and natural, not generic ("Great service!"). Author: a believable first-name + last-initial (e.g. "Sarah M.").`,

  cta: (ctx) =>
    `Write a closing call-to-action section for "${ctx.businessName}", a ${ctx.niche} business in ${ctx.city}.
Return ONLY JSON: {"heading": "...", "subtext": "...", "buttonLabel": "..."}
Heading: under 8 words, creates urgency or warmth without being pushy. Subtext: one sentence, under 18 words. buttonLabel: 2-4 words (e.g. "Get in touch", "Book a visit").`,
};

async function generateSectionCopy(userId, sectionKey, ctx) {
  const prompt = SECTION_PROMPTS[sectionKey](ctx);
  const result = await generateWithFallback(userId, prompt, { jsonMode: true });
  if (!result.ok) return { ok: false, error: result.error };
  try {
    const cleaned = result.text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    return { ok: true, data: JSON.parse(cleaned), provider: result.provider };
  } catch (err) {
    return { ok: false, error: `Could not parse AI response as JSON: ${err.message}` };
  }
}

module.exports = {
  COLOR_PRESETS,
  DESIGN_STYLES,
  SECTION_PROMPTS,
  generateSlug,
  slugify,
  generateSectionCopy,
};
