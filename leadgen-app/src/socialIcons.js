// Shared between the in-app template renderer (emailTemplates.js, which
// still uses these paths directly for the live browser preview, where
// inline SVG works perfectly) and the PNG rendering route below (used
// for actual sent emails, where inline SVG is unreliable - Outlook
// doesn't render it at all, and Gmail's support is inconsistent too).
// One source of truth for the icon shapes either way.
const SOCIAL_ICON_PATHS = {
  facebook: "M17 2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
  instagram:
    "M8 2h8a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6zm8 2H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4zm-4 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z",
  linkedin:
    "M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM3.5 8.5h3.9V21H3.5V8.5zm6.5 0h3.7v1.7h.05c.52-.98 1.78-2 3.66-2 3.9 0 4.63 2.57 4.63 5.9V21h-3.9v-6.06c0-1.44-.03-3.3-2.01-3.3-2.02 0-2.33 1.58-2.33 3.2V21h-3.9V8.5z",
  tiktok:
    "M16.5 2h-3.2v13.3a2.6 2.6 0 1 1-2.6-2.7c.24 0 .48.03.7.08V9.4a6 6 0 1 0 5.1 5.9V8.6a7.6 7.6 0 0 0 4.5 1.5V6.9a4.3 4.3 0 0 1-4.5-4.9z",
  website:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.94 9h-3.05c-.1-2.2-.62-4.15-1.4-5.6A8.02 8.02 0 0 1 19.94 11zM12 4.06c.9 1.1 1.67 3.2 1.83 5.94h-3.66c.16-2.74.93-4.84 1.83-5.94zM8.51 5.4c-.78 1.45-1.3 3.4-1.4 5.6H4.06A8.02 8.02 0 0 1 8.51 5.4zM4.06 13h3.05c.1 2.2.62 4.15 1.4 5.6A8.02 8.02 0 0 1 4.06 13zM12 19.94c-.9-1.1-1.67-3.2-1.83-5.94h3.66c-.16 2.74-.93 4.84-1.83 5.94zm2.49-1.34c.78-1.45 1.3-3.4 1.4-5.6h3.05a8.02 8.02 0 0 1-4.45 5.6z",
  email: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.4 2L12 12.5 19.6 7H4.4zM20 8.4l-7.4 5.4a1 1 0 0 1-1.2 0L4 8.4V17h16V8.4z",
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PNG_SIZE = 40; // rendered at 2x the typical 20px display size for crisp retina rendering

// In-memory cache, keyed by "icon:color" - the same icon+color
// combination gets requested constantly (every open of every email
// using that template), and re-rendering an identical PNG on every
// single request would be wasteful and could risk a slow load in
// clients with tight image-fetch timeouts. Resets on server restart,
// which just means the first request after a restart re-renders once.
const pngCache = new Map();

async function renderSocialIconPng(key, color) {
  const path = SOCIAL_ICON_PATHS[key];
  if (!path) return null;
  const safeColor = HEX_COLOR_RE.test(color) ? color : "#666666";
  const cacheKey = `${key}:${safeColor}`;
  if (pngCache.has(cacheKey)) return pngCache.get(cacheKey);

  const sharp = require("sharp");
  const svg = `<svg width="${PNG_SIZE}" height="${PNG_SIZE}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="${safeColor}"/></svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  pngCache.set(cacheKey, buffer);
  return buffer;
}

module.exports = { SOCIAL_ICON_PATHS, renderSocialIconPng, HEX_COLOR_RE };
