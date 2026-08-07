// Converts a plain-text generated email body into a tracked HTML email -
// the server-side equivalent of what the browser extension does by
// modifying the compose window's DOM before send. Same tracking model
// (invisible pixel + rewritten links through the click redirect), just
// built directly as HTML since there's no browser/compose-window involved
// in an automated send.

const URL_PATTERN = /(https?:\/\/[^\s<>")]+)/g;

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Turns plain-text body into simple HTML paragraphs, and rewrites any raw
// URL in the text into a real <a> tag pointing through the click-tracking
// redirect (so a link the AI wove into the message, e.g. a meeting link,
// gets click-tracked exactly like a link the extension would have
// rewritten in a browser compose window).
function buildTrackedHtmlEmail({ bodyText, pixelUrl, clickBaseUrl }) {
  const paragraphs = String(bodyText || "")
    .split(/\n{2,}/)
    .map((block) => {
      const withLineBreaks = escapeHtml(block).replace(/\n/g, "<br>");
      const withTrackedLinks = withLineBreaks.replace(URL_PATTERN, (url) => {
        const trackedHref = `${clickBaseUrl}?url=${encodeURIComponent(url)}`;
        return `<a href="${trackedHref}">${url}</a>`;
      });
      return `<p style="margin:0 0 14px 0;">${withTrackedLinks}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222; line-height: 1.5; max-width: 600px;">
${paragraphs}
<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none; width:1px; height:1px; border:0;" />
</body>
</html>`;
}

module.exports = { buildTrackedHtmlEmail };
