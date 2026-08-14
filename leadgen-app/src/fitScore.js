// Deterministic, instant fit-score - computed from data already
// scraped (rating, review count, business status, has-a-website,
// contactability), with zero AI calls and zero extra network requests.
// This is deliberately a *prospect* score, not a *quality* score - it is
// often the inverse of the existing business_analysis "overall_score"
// (which measures how good the business's current online presence is).
// A business with a poor website is often a *better* prospect for this
// agency, not a worse one - the whole point is an obvious, provable gap
// to pitch, not an already-solved problem.
//
// This base score exists so every lead has a usable grade the moment
// it's scraped, before anyone has spent an AI call or a send on it. The
// AI analysis pipeline (see businessAnalysis.js) computes a more
// informed version once it actually has page content and this agency's
// own service context to reason with, and overwrites this one when it
// finishes.
const db = require("./db");
const { isValidEmailAddress } = require("./emailValidation");

function gradeFromScore(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

// What fraction of other leads in the same niche have a review count at
// or below this one - review count alone means very different things in
// different niches (50 reviews is a lot for a niche boutique law firm,
// unremarkable for a busy restaurant), so this makes the "how
// established is this business" signal relative to comparable
// businesses instead of a single fixed threshold across every niche.
function getNicheReviewPercentile(nicheId, reviewCount) {
  if (!nicheId || reviewCount == null) return 0.5; // no comparison group or no data - stay neutral rather than guessing
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id WHERE cl.niche_id = ? AND l.review_count IS NOT NULL AND l.review_count <= ?) AS le_count,
         (SELECT COUNT(*) FROM leads l JOIN catch_logs cl ON cl.id = l.catch_log_id WHERE cl.niche_id = ? AND l.review_count IS NOT NULL) AS total_count`
    )
    .get(nicheId, reviewCount, nicheId);
  if (!row.total_count) return 0.5;
  return row.le_count / row.total_count;
}

function extractEmail(socialsJson) {
  try {
    const socials = JSON.parse(socialsJson || "{}");
    return socials.email || null;
  } catch {
    return null;
  }
}

// Returns { score, grade } - never throws, always returns a usable
// result even for a very sparse lead (unknown rating, no reviews yet).
function computeBaseFitScore(lead) {
  // Hard gate - a non-operational business is essentially worthless to
  // pursue regardless of how good its other signals look.
  if (lead.business_status && lead.business_status !== "OPERATIONAL") {
    return { score: 5, grade: "F" };
  }

  let score = 0;

  // 1. Business maturity / likely budget (0-35) - niche-relative review
  // count percentile, not a fixed threshold.
  const percentile = getNicheReviewPercentile(lead.niche_id, lead.review_count);
  score += Math.round(percentile * 35);

  // 2. Rating quality (0-20) - deliberately not linear. A business
  // sitting in the 3.3-4.9 range is established enough to have real
  // reviews but not so flawless that marketing help won't move the
  // needle. Very low ratings often point to a real service/operations
  // problem no amount of better marketing fixes, so they're scored down
  // rather than up despite being an "obvious gap."
  if (lead.rating != null) {
    if (lead.rating >= 3.3 && lead.rating <= 4.9) score += 20;
    else if (lead.rating >= 2.5) score += 12;
    else score += 4;
  } else {
    score += 8; // unknown - stay neutral rather than penalizing missing data
  }

  // 3. Opportunity / gap size (0-25) - no website at all is the
  // cleanest, highest-ticket opportunity (a full build, this agency's
  // core service); having a website still leaves real opportunity
  // (redesign, SEO, speed) just a smaller obvious gap than starting from
  // nothing.
  score += lead.website ? 12 : 25;

  // 4. Contactability (0-20) - a great prospect this agency has no way
  // to reach isn't worth much for cold outreach specifically, so this
  // is weighted meaningfully rather than treated as a footnote.
  const hasEmail = isValidEmailAddress(extractEmail(lead.socials));
  score += (hasEmail ? 14 : 0) + (lead.phone ? 6 : 0);

  const finalScore = Math.max(0, Math.min(100, score));
  return { score: finalScore, grade: gradeFromScore(finalScore) };
}

module.exports = { computeBaseFitScore, gradeFromScore, getNicheReviewPercentile };
