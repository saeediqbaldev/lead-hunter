// Rules-based checklist + scoring for the business deep-analysis feature.
// Deliberately does NOT make any new Google Places API call - GMB/Local SEO
// checks are built entirely from data already captured for free during the
// original hunt (rating, review count, business status, phone, website).
// Fetching fresh fields like opening hours or photos would push the Places
// API call into the expensive Enterprise SKU tier ($35-40 per 1,000 calls
// per Google's 2026 pricing), which contradicts the "free tools" goal -
// so this deliberately stays within what's already been paid for once.

const fetch = require("node-fetch");

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Website checks (live HTML fetch, no paid API) ----------
async function runWebsiteChecks(website) {
  const checks = [];

  if (!website) {
    checks.push({ label: "Has a website", status: "fail", detail: "No website found on the Google listing" });
    return { checks, score: 0 };
  }

  checks.push({ label: "Has a website", status: "pass", detail: website });
  checks.push({
    label: "SSL certificate (https)",
    status: website.startsWith("https://") ? "pass" : "fail",
  });

  let html = null;
  try {
    const res = await fetchWithTimeout(website, { redirect: "follow" });
    if (res.ok) html = await res.text();
    else checks.push({ label: "Website reachable", status: "fail", detail: `HTTP ${res.status}` });
  } catch (err) {
    checks.push({ label: "Website reachable", status: "fail", detail: err.message });
  }

  if (html) {
    const hasTitle = /<title[^>]*>([^<]{3,})<\/title>/i.test(html);
    checks.push({ label: "Has a title tag", status: hasTitle ? "pass" : "fail" });

    const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}["']/i.test(html);
    checks.push({ label: "Meta description", status: hasMetaDesc ? "pass" : "warn", detail: hasMetaDesc ? undefined : "missing or too short" });

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    checks.push({ label: "Mobile viewport tag", status: hasViewport ? "pass" : "fail" });

    const hasContactForm = /<form[^>]*>/i.test(html);
    checks.push({ label: "Contact form present", status: hasContactForm ? "pass" : "warn" });
  }

  // PageSpeed Insights (free, no API key required at low volume) - adds
  // performance/SEO/accessibility scores if reachable within the timeout.
  try {
    const psRes = await fetchWithTimeout(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(website)}&strategy=mobile&category=performance&category=seo&category=accessibility`,
      { timeout: 25000 }
    );
    if (psRes.ok) {
      const psData = await psRes.json();
      const cats = psData?.lighthouseResult?.categories || {};
      if (cats.performance) {
        const score = Math.round(cats.performance.score * 100);
        checks.push({ label: "Page load speed (mobile)", status: score >= 70 ? "pass" : score >= 40 ? "warn" : "fail", detail: `PageSpeed: ${score}/100` });
      }
      if (cats.seo) {
        const score = Math.round(cats.seo.score * 100);
        checks.push({ label: "Basic SEO signals", status: score >= 80 ? "pass" : "warn", detail: `PageSpeed SEO: ${score}/100` });
      }
      if (cats.accessibility) {
        const score = Math.round(cats.accessibility.score * 100);
        checks.push({ label: "Accessibility", status: score >= 80 ? "pass" : "warn", detail: `PageSpeed: ${score}/100` });
      }
    }
  } catch {
    // PageSpeed can be slow/flaky for some sites - not fatal, just skip this check
  }

  const score = scoreFromChecks(checks);
  return { checks, score };
}

// ---------- GMB & Local SEO checks (from already-captured lead data, zero new API cost) ----------
function runGmbChecks(lead) {
  const checks = [];

  checks.push({
    label: "Business status",
    status: lead.business_status === "OPERATIONAL" ? "pass" : "fail",
    detail: lead.business_status || "unknown",
  });

  if (lead.rating != null) {
    checks.push({ label: "GMB rating", status: lead.rating >= 4.0 ? "pass" : lead.rating >= 3.0 ? "warn" : "fail", detail: `${lead.rating.toFixed(1)} stars` });
  } else {
    checks.push({ label: "GMB rating", status: "warn", detail: "not pulled for this lead" });
  }

  if (lead.review_count != null) {
    checks.push({
      label: "Review count",
      status: lead.review_count >= 20 ? "pass" : lead.review_count >= 5 ? "warn" : "fail",
      detail: `${lead.review_count} reviews`,
    });
  } else {
    checks.push({ label: "Review count", status: "warn", detail: "not pulled for this lead" });
  }

  checks.push({ label: "Phone number listed", status: lead.phone ? "pass" : "fail" });
  checks.push({ label: "Address listed", status: lead.address ? "pass" : "fail" });

  const score = scoreFromChecks(checks);
  return { checks, score };
}

// ---------- Social presence checks (link resolution only - no official
// API can report follower/engagement data for a third party's account) ----------
async function runSocialChecks(socials) {
  const platforms = ["facebook", "instagram", "linkedin", "tiktok"];
  const checks = [];

  for (const platform of platforms) {
    const url = socials && socials[platform];
    if (!url) {
      checks.push({ label: `${capitalize(platform)} linked`, status: "fail", detail: "not found" });
      continue;
    }
    try {
      const res = await fetchWithTimeout(url, { method: "GET", redirect: "follow" });
      checks.push({
        label: `${capitalize(platform)} linked`,
        status: res.ok ? "pass" : "warn",
        detail: res.ok ? "link resolves" : `HTTP ${res.status} - may be blocked or broken`,
      });
    } catch (err) {
      checks.push({ label: `${capitalize(platform)} linked`, status: "warn", detail: "could not verify (network/blocking)" });
    }
  }

  const score = scoreFromChecks(checks);
  return { checks, score };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// pass=100%, warn=50%, fail=0%, averaged across all checks in the category
function scoreFromChecks(checks) {
  if (checks.length === 0) return 0;
  const points = checks.reduce((sum, c) => sum + (c.status === "pass" ? 100 : c.status === "warn" ? 50 : 0), 0);
  return Math.round(points / checks.length);
}

// ---------- Gemini writeup: strengths / weaknesses / suggested services ----------
// Uses Gemini's structured JSON output mode (responseSchema) instead of
// asking it to write free-form text and hoping to parse it reliably - the
// model is constrained to return exactly this shape.
const ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    strengths: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
    weaknesses: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
    suggestedServices: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
  },
  required: ["strengths", "weaknesses", "suggestedServices"],
};

function buildAnalysisPrompt(lead, categoryResults) {
  const allChecks = [
    ...categoryResults.website.checks,
    ...categoryResults.gmb.checks,
    ...categoryResults.social.checks,
  ];
  const checklistText = allChecks
    .map((c) => `- ${c.label}: ${c.status.toUpperCase()}${c.detail ? ` (${c.detail})` : ""}`)
    .join("\n");

  return `You are a marketing consultant analyzing a local business's online presence, to help a lead-generation agency pitch relevant services.

Business: ${lead.name}
Category: ${lead.niche_name || "local business"}
Location: ${lead.city_name || lead.address || "unknown"}

Here is a checklist of factors already checked programmatically (PASS/WARN/FAIL):
${checklistText}

Category scores: Website Health ${categoryResults.website.score}/100, GMB & Local SEO ${categoryResults.gmb.score}/100, Social Presence ${categoryResults.social.score}/100.

Based ONLY on the checklist above (don't invent facts not shown here), write:
1. 2-4 genuine strengths - specific, not generic praise
2. 2-4 genuine weaknesses - specific, actionable gaps
3. 2-3 suggested services this agency could pitch to this business, each a short phrase (e.g. "Website speed & mobile optimization"), directly tied to the weaknesses found

Keep every point concise (one sentence each) and grounded in the actual checklist data, not speculation.`;
}

async function analyzeWithGemini(apiKey, lead, categoryResults) {
  const { generateText } = require("./gemini");
  const prompt = buildAnalysisPrompt(lead, categoryResults);
  const result = await generateText(apiKey, prompt, { responseSchema: ANALYSIS_RESPONSE_SCHEMA });

  if (!result.ok) return { ok: false, error: result.error };

  try {
    const parsed = JSON.parse(result.text);
    if (!Array.isArray(parsed.strengths) || !Array.isArray(parsed.weaknesses) || !Array.isArray(parsed.suggestedServices)) {
      return { ok: false, error: "Gemini's response was missing expected fields." };
    }
    return { ok: true, ...parsed };
  } catch (err) {
    return { ok: false, error: `Could not parse Gemini's response as JSON: ${err.message}` };
  }
}

module.exports = { runWebsiteChecks, runGmbChecks, runSocialChecks, scoreFromChecks, buildAnalysisPrompt, analyzeWithGemini };
