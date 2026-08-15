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

// Strips HTML tags/scripts/styles down to plain visible text, collapsing
// whitespace - used both for a word-count heuristic and as a snippet fed
// to the AI for a genuine content-quality read, not just structural checks.
function extractVisibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Contact-form detection from a single no-JavaScript homepage fetch is
// inherently unreliable - a real form is very often rendered client-side
// after page load, embedded via a third-party service (Typeform, HubSpot,
// Calendly, JotForm, Google Forms, Formspree, and common WordPress form
// plugins), or lives on a dedicated /contact page rather than the
// homepage. A naive "no <form> tag found" check produces confident-
// sounding false negatives for all of these everyday, common cases -
// exactly the kind of wrong, embarrassing claim that must never reach a
// real prospect. This checks for the actual tag AND the fingerprints of
// every common way a form gets embedded without one.
function detectContactForm(html) {
  if (/<form[^>]*>/i.test(html)) return true;
  const thirdPartyPatterns = [
    /typeform\.com/i,
    /hubspot\.com\/.*forms?/i,
    /js\.hsforms/i,
    /calendly\.com/i,
    /jotform\.com/i,
    /forms\.gle/i,
    /docs\.google\.com\/forms/i,
    /formspree\.io/i,
    /wufoo\.com/i,
    /123formbuilder/i,
    /ninja-?forms/i,
    /gravityforms/i,
    /wpcf7|contact-form-7/i,
    /elementor-form/i,
    /formstack/i,
    /jetpack.*contact-form/i,
  ];
  return thirdPartyPatterns.some((p) => p.test(html));
}

// A copyright year is a genuinely concrete, verifiable signal for a
// stale/outdated site - unlike a structural guess, this is either
// literally printed on the page or it isn't, so it's safe to state with
// real confidence rather than hedging.
function detectCopyrightYear(html) {
  const matches = [...html.matchAll(/(?:©|&copy;|copyright)\s*(\d{4})/gi)].map((m) => parseInt(m[1], 10));
  if (!matches.length) return null;
  return Math.max(...matches);
}

// ---------- Website checks (live HTML fetch, no paid API) ----------
async function runWebsiteChecks(website) {
  const checks = [];

  if (!website) {
    checks.push({ label: "Has a website", status: "fail", detail: "No website found on the Google listing" });
    return { checks, score: 0, contentSnippet: null };
  }

  checks.push({ label: "Has a website", status: "pass", detail: website });

  let html = null;
  let finalUrl = website;
  try {
    const res = await fetchWithTimeout(website, { redirect: "follow" });
    // The SSL check must look at the ACTUAL final URL after following any
    // redirects, not the stored website string - a lead's website can be
    // saved as "http://example.com" while the site itself redirects to a
    // fully valid https:// version, which the old check (string-matching
    // the stored URL) would have wrongly flagged as "no SSL".
    finalUrl = res.url || website;
    if (res.ok) html = await res.text();
    else checks.push({ label: "Website reachable", status: "fail", detail: `HTTP ${res.status}` });
  } catch (err) {
    checks.push({ label: "Website reachable", status: "fail", detail: err.message });
  }

  checks.push({
    label: "SSL certificate (https)",
    status: finalUrl.startsWith("https://") ? "pass" : "fail",
    detail: finalUrl !== website ? `redirects to ${finalUrl}` : undefined,
  });

  let contentSnippet = null;
  if (html) {
    const hasTitle = /<title[^>]*>([^<]{3,})<\/title>/i.test(html);
    checks.push({ label: "Has a title tag", status: hasTitle ? "pass" : "fail" });

    const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}["']/i.test(html);
    checks.push({ label: "Meta description", status: hasMetaDesc ? "pass" : "warn", detail: hasMetaDesc ? undefined : "missing or too short" });

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    checks.push({ label: "Mobile viewport tag", status: hasViewport ? "pass" : "fail" });

    const hasContactFormOnHomepage = detectContactForm(html);
    let contactFormFound = hasContactFormOnHomepage;
    let contactFormDetail;
    if (!hasContactFormOnHomepage) {
      // Very common pattern: the contact form lives on its own page, not
      // the homepage - worth one more quick, cheap look before concluding
      // anything, since that's the single most likely reason a homepage
      // fetch alone wouldn't show one.
      try {
        const contactUrl = new URL("/contact", finalUrl).toString();
        const contactRes = await fetchWithTimeout(contactUrl, { redirect: "follow" });
        if (contactRes.ok) {
          const contactHtml = await contactRes.text();
          if (detectContactForm(contactHtml)) {
            contactFormFound = true;
            contactFormDetail = "found on /contact page";
          }
        }
      } catch {
        // /contact not reachable - not informative either way, just move on
      }
    }
    checks.push({
      label: "Contact form present",
      status: contactFormFound ? "pass" : "warn",
      // Deliberately hedged, never a confident "missing" - a single fetch
      // (even with the /contact fallback above) can't rule out a form
      // rendered by JavaScript or embedded through a widget this check
      // doesn't recognize, and stating it's absent when it might not be
      // is exactly the kind of claim that must never reach a real
      // prospect.
      detail: contactFormFound ? contactFormDetail : "not detected on the homepage or /contact - may still exist via JavaScript or a different page",
    });

    const copyrightYear = detectCopyrightYear(html);
    if (copyrightYear) {
      const currentYear = new Date().getFullYear();
      const age = currentYear - copyrightYear;
      checks.push({
        label: "Copyright year (footer)",
        status: age <= 1 ? "pass" : age <= 3 ? "warn" : "fail",
        detail: `${copyrightYear}${age > 1 ? ` (${age} years old)` : ""}`,
      });
    }

    // Rough navigation signal - not a claim about UX quality (which the
    // AI should read from the actual content/structure), just a
    // concrete, countable fact: how many distinct internal links exist,
    // as a floor-level check for "is there basically a site here beyond
    // one page."
    const internalLinkCount = new Set((html.match(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["']/gi) || [])).size;
    checks.push({ label: "Internal navigation links found", status: internalLinkCount >= 4 ? "pass" : "warn", detail: `${internalLinkCount} distinct links found on the homepage` });

    // Structured data (schema.org JSON-LD or microdata) helps a business
    // show up richer in search results - a genuinely useful, checkable signal.
    const hasStructuredData = /<script[^>]+type=["']application\/ld\+json["']/i.test(html) || /itemscope/i.test(html);
    checks.push({ label: "Structured data (schema.org)", status: hasStructuredData ? "pass" : "warn", detail: hasStructuredData ? undefined : "not found - helps rich search results" });

    // Image alt-text coverage - accessibility + basic on-page SEO signal.
    const imgTags = html.match(/<img\b[^>]*>/gi) || [];
    if (imgTags.length > 0) {
      const withAlt = imgTags.filter((tag) => /\balt\s*=\s*["'][^"']+["']/i.test(tag)).length;
      const altRatio = withAlt / imgTags.length;
      checks.push({
        label: "Image alt text coverage",
        status: altRatio >= 0.8 ? "pass" : altRatio >= 0.4 ? "warn" : "fail",
        detail: `${withAlt}/${imgTags.length} images have alt text`,
      });
    }

    // Content depth - a very thin page (just a logo and a phone number)
    // is a genuinely different problem than a slow page, and worth
    // surfacing as its own signal rather than folding it into "SEO".
    contentSnippet = extractVisibleText(html);
    const wordCount = contentSnippet ? contentSnippet.split(/\s+/).filter(Boolean).length : 0;
    checks.push({
      label: "Content depth",
      status: wordCount >= 200 ? "pass" : wordCount >= 60 ? "warn" : "fail",
      detail: `~${wordCount} words of visible text`,
    });
    // Keep only a bounded snippet from here on - enough for the AI to make
    // a genuine quality read without ballooning the prompt.
    contentSnippet = contentSnippet ? contentSnippet.slice(0, 1500) : null;
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
  return { checks, score, contentSnippet };
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
    fitScore: { type: "integer" },
    fitReason: { type: "string" },
    mismatch: { type: "boolean" },
    mismatchReason: { type: "string" },
  },
  required: ["strengths", "weaknesses", "suggestedServices", "fitScore", "fitReason", "mismatch"],
};

function buildAnalysisPrompt(lead, categoryResults, agencyProfile) {
  const allChecks = [
    ...categoryResults.website.checks,
    ...categoryResults.gmb.checks,
    ...categoryResults.social.checks,
  ];
  const checklistText = allChecks
    .map((c) => `- ${c.label}: ${c.status.toUpperCase()}${c.detail ? ` (${c.detail})` : ""}`)
    .join("\n");

  const contentSection = categoryResults.website.contentSnippet
    ? `\n\nActual visible text extracted from the homepage (for judging genuine content quality - clarity, professionalism, whether it explains what the business does and why to choose them - not just the structural checks above; also use this to judge whether the site genuinely belongs to THIS business, see the mismatch instructions below):\n"""\n${categoryResults.website.contentSnippet}\n"""`
    : "";

  const agencySection = agencyProfile
    ? `\n\nThis agency's own profile (use this to judge fit specifically for THEM, not generic marketing advice):\n"""\n${agencyProfile}\n"""`
    : "";

  return `You are a marketing consultant analyzing a local business's online presence, to help a lead-generation agency pitch relevant services.

Business: ${lead.name}
Category: ${lead.niche_name || "local business"}
Location: ${lead.city_name || lead.address || "unknown"}
Google rating: ${lead.rating != null ? `${lead.rating} stars` : "unknown"}, ${lead.review_count != null ? `${lead.review_count} reviews` : "review count unknown"}

Here is a checklist of factors already checked programmatically (PASS/WARN/FAIL):
${checklistText}

Category scores: Website Health ${categoryResults.website.score}/100, GMB & Local SEO ${categoryResults.gmb.score}/100, Social Presence ${categoryResults.social.score}/100.${contentSection}${agencySection}

Based on the checklist above and the actual page content if given (don't invent facts not shown here), respond with ONLY a JSON object (no other text, no markdown code fences) in exactly this shape:
{
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "suggestedServices": ["...", "..."],
  "fitScore": 72,
  "fitReason": "...",
  "mismatch": false,
  "mismatchReason": ""
}

Rules:
- 2-4 genuine strengths (specific, not generic praise), 2-4 genuine weaknesses (specific, actionable gaps).
- CRITICAL: never state something is "missing," "doesn't have," or "lacks" X unless the checklist marks that exact item FAIL (a confidently, directly observed fact), or the actual page content given above clearly shows it's absent. A checklist item marked WARN with hedged wording like "not detected" or "couldn't confirm" means exactly that - it is NOT a confident claim that the thing is actually missing. A single automated page fetch can't see everything a real visitor would: content added by JavaScript after load, a form embedded through a widget this check doesn't recognize, or a page this fetch never reached. Turning an uncertain signal into a confident claim is the single most damaging mistake possible here - it is exactly the kind of wrong, embarrassing statement that destroys trust the moment a real recipient reads it and knows it's false, because they're looking at their own website right now. When a signal is uncertain, either leave it out of weaknesses entirely, or phrase around what's actually confirmed ("the homepage doesn't clearly showcase X" rather than "there is no X").
- Weigh EVERY aspect of the business's online presence, not just the GMB rating/review count/reputation signals - actively look for things to say about the actual website content given above. Consider: is the copywriting clear and persuasive or generic and thin (Content/Copywriting); are there obvious gaps beyond meta tags like thin content or no clear service/location keywords (SEO); is the page easy to navigate and well-structured, does it guide a visitor toward an action (UX/UI, Navigation); does the design read as current or dated - a copyright year shown in the checklist several years old is a real, confirmed fact worth using directly, not a guess (Outdated design). A good analysis draws from several of these angles, not just "reviews are good, website could be better."
- 2-3 suggestedServices this agency could pitch, each a short phrase (e.g. "Local SEO optimization") - these MUST be services this agency actually offers per its profile above, not generic marketing services it may not provide. If no agency profile was given, keep suggestions generic and clearly service-oriented.
- If page content was given above, weigh in on genuine content quality too (is it clear what the business does, does it read professionally, is there a real call to action) alongside the structural checklist - a page can pass every structural check and still read poorly, or vice versa.
- fitScore (0-100) is NOT the same thing as the website/GMB/social health scores above, and is very often the *inverse* of them - it measures how good a PROSPECT this business is for cold outreach from THIS specific agency, not how good their current online presence already is. A business with a poor or missing website is often a BETTER prospect (an obvious, provable gap this agency's own services fix), not a worse one. Weigh: (a) does this business look established enough to plausibly afford these services (reviews, rating, being open) - a very new or clearly struggling business may not have budget yet; (b) is there a real, specific, provable gap here that maps to a service this agency actually offers; (c) would pitching this specific agency's services to this specific business make obvious sense. Score low if the business is not operational, has no real weaknesses to pitch, or the gaps found don't map to anything this agency offers.
- fitReason: one concise sentence explaining the fitScore - specific enough to be useful at a glance (e.g. "140 reviews and 4.1 stars but no online booking or mobile-friendly site" not "decent business, could use help").
- mismatch: true only if the actual page content clearly does NOT belong to this specific business (e.g. it's a different company entirely, a franchise corporate homepage instead of the local branch, a generic directory/aggregator listing, or content unrelated to "${lead.name}") - leave false if the site plausibly belongs to this business even if you can't be fully certain. If true, mismatchReason must briefly explain why (e.g. "Page content describes a different company - a national franchise HQ site, not this local branch").
- Keep every point concise (one sentence each) and grounded in what was actually given, not speculation.`;
}

// Uses the AI provider fallback chain (Groq -> Gemini -> DeepSeek) instead
// of calling one provider directly. The prompt above includes an explicit
// JSON shape example so this works reliably across all three providers,
// not just Gemini's stricter schema-constrained mode (geminiSchema is
// still passed through so Gemini gets its stronger guarantee specifically
// when it's the one that ends up being used).
async function analyzeWithAI(userId, lead, categoryResults, aiProvider, agencyProfile) {
  const { generateWithFallback } = require("./aiProviders");
  const { gradeFromScore } = require("./fitScore");
  const prompt = buildAnalysisPrompt(lead, categoryResults, agencyProfile);
  const result = await generateWithFallback(userId, prompt, { jsonMode: true, geminiSchema: ANALYSIS_RESPONSE_SCHEMA, onlyProvider: aiProvider || undefined });

  if (!result.ok) return { ok: false, error: result.error };

  try {
    // Strip markdown code fences if a non-Gemini provider added them
    // despite instructions not to - cheap and harmless if there are none.
    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.strengths) || !Array.isArray(parsed.weaknesses) || !Array.isArray(parsed.suggestedServices)) {
      return { ok: false, error: `${result.provider}'s response was missing expected fields.` };
    }

    // Clamp/validate the fit fields rather than trusting the model's
    // output blindly - a malformed or out-of-range value here shouldn't
    // corrupt what gets stored and shown as this lead's grade.
    const rawScore = Number(parsed.fitScore);
    const fitScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
    const fitGrade = fitScore != null ? gradeFromScore(fitScore) : null;
    const mismatch = parsed.mismatch === true;

    return {
      ok: true,
      ...parsed,
      fitScore,
      fitGrade,
      fitReason: typeof parsed.fitReason === "string" ? parsed.fitReason.trim() : null,
      mismatch,
      mismatchReason: mismatch && typeof parsed.mismatchReason === "string" ? parsed.mismatchReason.trim() : null,
      provider: result.provider,
    };
  } catch (err) {
    return { ok: false, error: `Could not parse ${result.provider}'s response as JSON: ${err.message}` };
  }
}

module.exports = { runWebsiteChecks, runGmbChecks, runSocialChecks, scoreFromChecks, buildAnalysisPrompt, analyzeWithAI };
