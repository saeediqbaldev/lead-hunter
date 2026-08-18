// Converts a plain-text generated email body into a tracked HTML email -
// the server-side equivalent of what the browser extension does by
// modifying the compose window's DOM before send. Same tracking model
// (invisible pixel + rewritten links through the click redirect), just
// built directly as HTML since there's no browser/compose-window involved
// in an automated send.

const URL_PATTERN = /(https?:\/\/[^\s<>")]+)/g;

// Common sentence-ending/list punctuation that a URL regex will greedily
// swallow if it happens to appear immediately after a link with no space
// (e.g. "book here: https://cal.com/you/15min." - the AI writes normal
// prose, so a trailing period is expected, not an edge case). Strips any
// of these off the END of a matched URL and returns them separately so
// they can be placed back into the surrounding text instead of the href.
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function splitTrailingPunctuation(url) {
  const match = url.match(TRAILING_PUNCTUATION);
  if (!match) return { cleanUrl: url, trailing: "" };
  return { cleanUrl: url.slice(0, -match[0].length), trailing: match[0] };
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Rewrites any relative image src (e.g. an uploaded signature image at
// "/uploads/signatures/...") to an absolute URL. Required because a
// recipient's email client has no "current page" to resolve a relative
// URL against the way a browser does - a relative src just silently
// fails to load, showing the recipient a broken-image placeholder
// instead of the actual signature image.
function resolveRelativeImageUrls(html, baseUrl) {
  if (!html) return "";
  return html.replace(/src\s*=\s*"(\/[^"]*)"/gi, (match, relativePath) => `src="${baseUrl}${relativePath}"`);
}

// Turns plain-text body into simple HTML paragraphs, and rewrites any raw
// URL in the text into a real <a> tag pointing through the click-tracking
// redirect (so a link the AI wove into the message, e.g. a meeting link,
// gets click-tracked exactly like a link the extension would have
// rewritten in a browser compose window).
function trackSignatureLinks(signatureHtml, clickBaseUrl) {
  if (!signatureHtml) return "";
  return signatureHtml.replace(/href\s*=\s*"([^"]+)"/gi, (match, href) => {
    if (!/^https?:\/\//i.test(href)) return match; // leave mailto:/tel:/relative links untouched
    return `href="${clickBaseUrl}?url=${encodeURIComponent(href)}"`;
  });
}

const { renderEmailHtml } = require("./emailTemplates");

function buildTrackedHtmlEmail({ bodyText, signatureHtml, pixelUrl, clickBaseUrl, baseUrl, templateKey, templateSettings, universalLinks, logoUrl }) {
  // Returns just the tracked URL - both call sites below build their own
  // <a> tag from it, since the template path (emailTemplates.js) and the
  // plain path each handle surrounding text slightly differently.
  const rewriteUrlForTracking = (url) => `${clickBaseUrl}?url=${encodeURIComponent(url)}`;

  const trackedSignature = trackSignatureLinks(resolveRelativeImageUrls(signatureHtml, baseUrl), clickBaseUrl);

  if (templateKey) {
    // Template path - real layout/styling from the template system, but
    // still the exact same tracking: body links go through the click
    // redirect, signature links and images are handled identically to
    // the plain path, and the same pixel gets appended at the end.
    const templateHtml = renderEmailHtml({
      templateKey,
      customSettings: templateSettings,
      bodyText,
      signatureHtml: trackedSignature,
      universalLinks,
      logoUrl: logoUrl && logoUrl.startsWith("/") ? `${baseUrl}${logoUrl}` : logoUrl,
      linkRewriter: rewriteUrlForTracking,
    });
    return `<!DOCTYPE html>
<html>
<body style="margin:0; padding:0;">
${templateHtml}
<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none; width:1px; height:1px; border:0;" />
</body>
</html>`;
  }

  // Plain path - completely unchanged from before templates existed.
  const paragraphs = String(bodyText || "")
    .split(/\n{2,}/)
    .map((block) => {
      const withLineBreaks = escapeHtml(block).replace(/\n/g, "<br>");
      const withTrackedLinks = withLineBreaks.replace(URL_PATTERN, (url) => {
        const { cleanUrl, trailing } = splitTrailingPunctuation(url);
        return `<a href="${rewriteUrlForTracking(cleanUrl)}">${cleanUrl}</a>${trailing}`;
      });
      return `<p style="margin:0 0 14px 0;">${withTrackedLinks}</p>`;
    })
    .join("\n");

  const signatureBlock = trackedSignature ? `<div style="margin-top:18px; padding-top:14px; border-top:1px solid #e0e0e0;">${trackedSignature}</div>` : "";

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222; line-height: 1.5; max-width: 600px;">
${paragraphs}
${signatureBlock}
<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none; width:1px; height:1px; border:0;" />
</body>
</html>`;
}

module.exports = { buildTrackedHtmlEmail };
