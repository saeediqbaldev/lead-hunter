const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { parseUserAgent, lookupGeoIp } = require("../trackingMeta");
const { sendEmailNotification } = require("../trackerNotify");
const { isLikelyBotOrScanner } = require("../botFilter");

const router = express.Router();

// Auto-pins the lead behind a tracked email once their email is seen
// (opened or clicked) - only works for campaign-sent emails, since
// that's the only path with a reliable tracked_email -> lead link;
// manually-sent emails via the browser extension have no such link.
// Deliberately only pins (never unpins) and never overwrites an existing
// pin_reason, so this doesn't fight a manual pin/unpin the user already made.
function autoPinLeadForEmail(trackedEmailId, reason) {
  try {
    const campaignLead = db.prepare("SELECT lead_id FROM email_campaign_leads WHERE tracked_email_id = ?").get(trackedEmailId);
    if (!campaignLead) return;
    db.prepare("UPDATE leads SET pinned = 1, pin_reason = ? WHERE id = ? AND pinned = 0").run(reason, campaignLead.lead_id);
  } catch (err) {
    console.error("[auto-pin] Failed to auto-pin lead for tracked email", trackedEmailId, ":", err.message);
  }
}


const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function clientIp(req) {
  const fwd = req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress;
}

// Resolves an x-api-key header to the user it belongs to - keys are
// per-user (not one global key like the original single-admin tool),
// generated automatically the first time a user opens the setup page.
function resolveUserByApiKey(req) {
  const key = req.header("x-api-key");
  if (!key) return null;
  return db.prepare("SELECT id FROM users WHERE tracker_api_key = ?").get(key) || null;
}

function requireApiKey(req, res, next) {
  const user = resolveUserByApiKey(req);
  if (!user) return res.status(401).json({ error: "Invalid or missing API key" });
  req.trackerUserId = user.id;
  next();
}

// Accepts either a dashboard session OR an API key - used by /stats, which
// both the extension popup (API key) and the dashboard (session) call.
function requireSessionOrApiKey(req, res, next) {
  if (req.session && req.session.userId) {
    req.trackerUserId = req.session.userId;
    return next();
  }
  const user = resolveUserByApiKey(req);
  if (user) {
    req.trackerUserId = user.id;
    return next();
  }
  return res.status(401).json({ error: "Not authorized" });
}

// ---- Called by the browser extension right before/at send time ----
router.post("/api/tracker/emails", requireApiKey, (req, res) => {
  const { subject, recipients, sender } = req.body || {};
  const provider = "hostinger"; // only provider wired up for now

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "recipients must be a non-empty array" });
  }

  try {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO tracked_emails (id, user_id, subject, recipients, sender, sender_ip, provider) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.trackerUserId, subject || "", JSON.stringify(recipients), sender || null, clientIp(req), provider);

    const row = db.prepare("SELECT created_at FROM tracked_emails WHERE id = ?").get(id);
    const base = `${req.protocol}://${req.get("host")}`;

    res.json({
      id,
      pixelUrl: `${base}/t/${id}/pixel.png`,
      clickBaseUrl: `${base}/t/${id}/click`,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error("Failed to create tracked email:", err);
    res.status(500).json({ error: "Failed to create tracked email" });
  }
});

// ---- Called by the browser extension right after it injects the
// tracking pixel and rewrites links, so the actually-sent HTML (compose
// body plus pixel plus rewritten links) is what gets stored - the
// initial POST above happens before that injection, so it couldn't have
// included this even if it tried. ----
router.patch("/api/tracker/emails/:id/body", requireApiKey, (req, res) => {
  const { bodyHtml } = req.body || {};
  if (typeof bodyHtml !== "string" || !bodyHtml.trim()) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }
  const email = db.prepare("SELECT id FROM tracked_emails WHERE id = ? AND user_id = ?").get(req.params.id, req.trackerUserId);
  if (!email) return res.status(404).json({ error: "Tracked email not found" });

  db.prepare("UPDATE tracked_emails SET body_html = ? WHERE id = ?").run(bodyHtml, req.params.id);
  res.json({ ok: true });
});

// GET /api/tracker/stats - used by the extension popup
router.get("/api/tracker/stats", requireSessionOrApiKey, (req, res) => {
  try {
    const { provider } = req.query;
    const providerClause = provider ? "AND provider = ?" : "";
    const providerArgs = provider ? [provider] : [];
    const row = db
      .prepare(
        `SELECT
          COUNT(*) AS total_sent,
          SUM(CASE WHEN status IN ('opened','clicked') THEN 1 ELSE 0 END) AS total_opened,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS total_unopened,
          SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) AS total_clicked,
          COALESCE(SUM(open_count), 0) AS total_open_events
        FROM tracked_emails WHERE user_id = ? ${providerClause}`
      )
      .get(req.trackerUserId, ...providerArgs);
    const openRate = row.total_sent > 0 ? row.total_opened / row.total_sent : 0;
    res.json({ ...row, open_rate: openRate });
  } catch (err) {
    console.error("Failed to load tracker stats:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// How long after sending to ignore pixel hits - covers the sender's own
// mail client auto-loading images when it renders the Sent-folder copy.
const OPEN_GRACE_MS = 8000;

// ---- Tracking pixel ----
router.get("/t/:id/pixel.png", (req, res) => {
  res.set({
    "Content-Type": "image/png",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });

  const { id } = req.params;
  const uuidLike = /^[0-9a-f-]{36}$/i.test(id);

  if (uuidLike) {
    try {
      const email = db
        .prepare("SELECT sender_ip, created_at, first_opened_at, subject, recipients, user_id FROM tracked_emails WHERE id = ?")
        .get(id);

      if (email) {
        const requestIp = clientIp(req);
        const userAgent = req.header("user-agent") || "";

        const isSelf = email.sender_ip && requestIp && email.sender_ip === requestIp;
        const withinGrace = Date.now() - new Date(email.created_at.replace(" ", "T") + "Z").getTime() < OPEN_GRACE_MS;
        const isBot = isLikelyBotOrScanner(userAgent);
        const isFirstOpen = !email.first_opened_at;

        console.log(
          `[tracker-pixel] hit for ${id}: requestIp=${requestIp} senderIp=${email.sender_ip} isSelf=${isSelf} withinGrace=${withinGrace} isBot=${isBot} userAgent="${userAgent}" -> ${
            !isSelf && !withinGrace && !isBot ? "RECORDING open" : "SUPPRESSED"
          }`
        );

        if (!isSelf && !withinGrace && !isBot) {
          const { browser, os, device } = parseUserAgent(userAgent);
          const insertResult = db
            .prepare("INSERT INTO tracked_opens (email_id, ip, user_agent, browser, os, device) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, requestIp, userAgent || null, browser, os, device);

          // Geolocation needs an external lookup - doesn't block the pixel
          // response (the email client is waiting on this), so it updates
          // the row after the fact once (if) it resolves.
          const openRowId = insertResult.lastInsertRowid;
          lookupGeoIp(requestIp)
            .then((geo) => {
              if (geo) db.prepare("UPDATE tracked_opens SET city = ?, country = ? WHERE id = ?").run(geo.city, geo.country, openRowId);
            })
            .catch(() => {});

          db.prepare(
            `UPDATE tracked_emails
             SET status = 'opened', open_count = open_count + 1,
                 first_opened_at = COALESCE(first_opened_at, datetime('now')),
                 last_opened_at = datetime('now')
             WHERE id = ?`
          ).run(id);

          autoPinLeadForEmail(id, "Email Seen");

          if (isFirstOpen) {
            const recipients = JSON.parse(email.recipients || "[]");
            const who = recipients.join(", ") || "unknown recipient";
            const subj = email.subject || "(no subject)";
            const message = `"${subj}" was opened by ${who}`;

            db.prepare("INSERT INTO tracked_notifications (email_id, user_id, type, message) VALUES (?, ?, 'open', ?)").run(
              id,
              email.user_id,
              message
            );

            sendEmailNotification(email.user_id, {
              subject: `Opened: ${subj}`,
              text: `${message}\n\nOpened at: ${new Date().toISOString()}`,
            }).catch((err) => console.error("[tracker-notify] open email failed:", err.message));
          }
        } else if (isBot) {
          console.log(`[bot-filter] Ignored pixel hit from suspected scanner/proxy UA: "${userAgent}"`);
        }
      }
    } catch (err) {
      console.error("Pixel logging failed:", err.message);
    }
  }

  res.status(200).end(TRANSPARENT_PNG);
});

// ---- Link click redirect ----
router.get("/t/:id/click", (req, res) => {
  const { id } = req.params;
  const target = req.query.url;

  if (!target) return res.status(400).send("Missing url");

  let decoded;
  try {
    decoded = decodeURIComponent(target);
    const parsed = new URL(decoded);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch (e) {
    return res.status(400).send("Invalid url");
  }

  const uuidLike = /^[0-9a-f-]{36}$/i.test(id);
  if (uuidLike) {
    const userAgent = req.header("user-agent") || "";
    const isBot = isLikelyBotOrScanner(userAgent);

    if (isBot) {
      console.log(`[bot-filter] Ignored click hit from suspected scanner/preview-bot UA: "${userAgent}"`);
      return res.redirect(302, decoded);
    }

    try {
      const clickerIp = clientIp(req);
      const { browser, os, device } = parseUserAgent(userAgent);
      const insertResult = db
        .prepare("INSERT INTO tracked_clicks (email_id, url, ip, user_agent, browser, os, device) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, decoded, clickerIp, userAgent || null, browser, os, device);
      db.prepare("UPDATE tracked_emails SET status = 'clicked', click_count = click_count + 1 WHERE id = ?").run(id);
      autoPinLeadForEmail(id, "Email Link Clicked");

      const clickRowId = insertResult.lastInsertRowid;
      lookupGeoIp(clickerIp)
        .then((geo) => {
          if (geo) db.prepare("UPDATE tracked_clicks SET city = ?, country = ? WHERE id = ?").run(geo.city, geo.country, clickRowId);
        })
        .catch(() => {});

      const email = db.prepare("SELECT subject, recipients, user_id FROM tracked_emails WHERE id = ?").get(id);
      if (email) {
        const recipients = JSON.parse(email.recipients || "[]");
        const who = recipients.join(", ") || "unknown recipient";
        const subj = email.subject || "(no subject)";
        const message = `${who} clicked a link in "${subj}"`;

        db.prepare("INSERT INTO tracked_notifications (email_id, user_id, type, url, message) VALUES (?, ?, 'click', ?, ?)").run(
          id,
          email.user_id,
          decoded,
          message
        );

        sendEmailNotification(email.user_id, {
          subject: `Link clicked: ${subj}`,
          text: `${message}\n\nURL: ${decoded}\nClicked at: ${new Date().toISOString()}`,
        }).catch((err) => console.error("[tracker-notify] click email failed:", err.message));
      }
    } catch (err) {
      console.error("Click logging failed:", err.message);
    }
  }

  res.redirect(302, decoded);
});

module.exports = router;
