// Drives the fully-autonomous daily pipeline: pick an untried
// (niche, country) pair, search its top cities, hand off to the
// existing country-wide contact scraper, then build and start a
// campaign - end to end, once per day, no human review step. Every
// meaningful action is logged to automation_timeline_events, which is
// what the automation page's timeline actually renders.
//
// Deliberately tick-based (small, resumable steps) rather than one long
// async function - the city-search phase alone can take many minutes
// across 20 sequential API calls, and a server restart mid-run must
// resume exactly where it left off, not lose all progress or duplicate
// work already done.

const db = require("./db");
const { SUPPORTED_AUTOMATION_COUNTRIES, getTopCitiesForCountry } = require("./topCitiesByCountry");
const { performSearch } = require("./routes/search");
const { startCountryScrape } = require("./countryScrapeOrchestrator");
const { getLanguageForCountry } = require("./countryLanguage");
const { createCampaign } = require("./routes/campaigns");
const { TONES } = require("./outreachContent");

const AUTOMATION_CTA_LINK = "https://cal.com/xevenpixels/discovery-call";
const AUTOMATION_WHATSAPP_LINK = "https://wa.me/+447459873726";

const TICK_INTERVAL_MS = 30000; // 30s - background pacing, not a UI-facing poll
let tickTimer = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function logEvent(runId, eventType, message) {
  db.prepare("INSERT INTO automation_timeline_events (run_id, event_type, message) VALUES (?, ?, ?)").run(runId, eventType, message);
}

function updateRun(runId, fields) {
  const keys = Object.keys(fields);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE automation_runs SET ${setClause} WHERE id = ?`).run(...keys.map((k) => fields[k]), runId);
}

function getRun(runId) {
  return db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(runId);
}

// Finds the first (niche, country) combination this user hasn't already
// covered - "already covered" means at least one catch log already
// exists for that niche in that country, whether it got there through
// a manual hunt (before automation ever ran) or a previous automation
// cycle. Iterates niches in creation order, and for each niche, the 30
// supported countries in the order they're listed in
// topCitiesByCountry.js - a deterministic, predictable rotation rather
// than anything random.
function findNextNicheCountryPair(userId) {
  const niches = db.prepare("SELECT * FROM niches WHERE user_id = ? ORDER BY id ASC").all(userId);
  for (const niche of niches) {
    for (const country of SUPPORTED_AUTOMATION_COUNTRIES) {
      const existing = db.prepare("SELECT id FROM catch_logs WHERE niche_id = ? AND country = ? LIMIT 1").get(niche.id, country);
      if (!existing) return { niche, country };
    }
  }
  return null; // every niche x supported-country combination already covered
}

// Whether a new cycle is allowed to start today - at most one per day,
// and never while a previous cycle (today's or, if it somehow ran long,
// an earlier day's) is still actively in progress.
function canStartNewRunToday(userId) {
  const today = todayStr();
  const todaysRun = db.prepare("SELECT id FROM automation_runs WHERE user_id = ? AND run_date = ?").get(userId, today);
  if (todaysRun) return false;
  const stillActive = db
    .prepare("SELECT id FROM automation_runs WHERE user_id = ? AND status NOT IN ('completed', 'failed')")
    .get(userId);
  if (stillActive) return false;
  return true;
}

async function maybeStartNewRuns() {
  const enabledUsers = db.prepare("SELECT user_id FROM automation_settings WHERE enabled = 1").all();
  for (const { user_id: userId } of enabledUsers) {
    if (!canStartNewRunToday(userId)) continue;

    const pair = findNextNicheCountryPair(userId);
    if (!pair) {
      // Nothing left to automate for this user - log this once per day
      // it's checked, so it's visible on the page rather than the
      // automation just silently never doing anything.
      const today = todayStr();
      const alreadyNoted = db.prepare("SELECT id FROM automation_runs WHERE user_id = ? AND run_date = ? AND status = 'nothing_to_do'").get(userId, today);
      if (!alreadyNoted) {
        const info = db
          .prepare("INSERT INTO automation_runs (user_id, run_date, niche_id, niche_name, country, status) VALUES (?, ?, 0, '', '', 'nothing_to_do')")
          .run(userId, today);
        logEvent(info.lastInsertRowid, "nothing_to_do", "Every niche has already been covered for all 30 supported countries - nothing new to automate today.");
      }
      continue;
    }

    const cities = getTopCitiesForCountry(pair.country);
    const info = db
      .prepare(
        "INSERT INTO automation_runs (user_id, run_date, niche_id, niche_name, country, status, total_cities, current_city_index) VALUES (?, ?, ?, ?, ?, 'searching_cities', ?, 0)"
      )
      .run(userId, todayStr(), pair.niche.id, pair.niche.name, pair.country, cities.length);
    const runId = info.lastInsertRowid;
    logEvent(runId, "started", `Starting today's automation: "${pair.niche.name}" in ${pair.country} (${cities.length} cities to search).`);
  }
}

// Advances every run currently in the "searching_cities" phase by
// exactly one city - keeps each tick fast and means a crash or restart
// mid-phase resumes at the next unsearched city, never redoing work
// already saved to the database.
async function advanceCitySearches() {
  const activeRuns = db.prepare("SELECT * FROM automation_runs WHERE status = 'searching_cities'").all();
  for (const run of activeRuns) {
    const cities = getTopCitiesForCountry(run.country);
    if (run.current_city_index >= cities.length) {
      // Every city has been attempted - move to the next phase.
      updateRun(run.id, { status: "scraping_contacts", current_step_detail: "Starting contact scrape for all cities" });
      logEvent(run.id, "city_search_completed", `Finished searching all ${cities.length} cities in ${run.country}.`);
      continue;
    }

    const city = cities[run.current_city_index];
    updateRun(run.id, { current_step_detail: `Searching city ${run.current_city_index + 1} of ${cities.length}: ${city}` });

    try {
      const result = await performSearch(run.user_id, true, {
        keyword: run.niche_name,
        location: city,
        maxResults: 60,
        includeRatings: true,
        nicheId: run.niche_id,
        country: run.country,
      });
      logEvent(run.id, "city_search_completed", `${city}: found ${result.pulled} new lead(s).`);
    } catch (err) {
      // One city failing (no results, daily cap reached, transient API
      // error) shouldn't stall the whole country - log it and move on,
      // same resilience pattern the existing country-scrape system uses.
      logEvent(run.id, "city_search_failed", `${city}: ${err.message}`);
    }

    updateRun(run.id, { current_city_index: run.current_city_index + 1 });
  }
}

// Phase 2: hand off to the existing country-wide contact scraper once
// every city has been searched. That system only allows one scrape
// running at a time, globally - a conflict there is transient (this
// user's own manual scrape, or another automation cycle) and just
// means waiting for the next tick, not a real failure.
async function advanceContactScraping() {
  const activeRuns = db.prepare("SELECT * FROM automation_runs WHERE status = 'scraping_contacts'").all();
  for (const run of activeRuns) {
    if (!run.country_scrape_job_id) {
      try {
        const job = await startCountryScrape(run.user_id, run.niche_id, run.country);
        const jobCityCount = JSON.parse(job.catch_log_ids || "[]").length;
        updateRun(run.id, {
          country_scrape_job_id: job.id,
          current_step_detail: `Scraping contact details for all leads in ${run.country}`,
          current_city_index: 0,
          total_cities: jobCityCount,
        });
        logEvent(run.id, "contact_scrape_started", `Started scraping contact details for every lead found in ${run.country}.`);
      } catch (err) {
        if (err.message.includes("already running")) {
          // Not this run's fault - just wait for the other scrape to finish.
          logEvent(run.id, "contact_scrape_waiting", `Waiting for another scrape job to finish before scraping contacts in ${run.country}.`);
        } else if (err.message.includes("No cities found")) {
          // None of the 20 cities turned up a lead with a website to
          // scrape - genuinely nothing to do here, move straight on
          // rather than waiting forever for a job that can never start.
          updateRun(run.id, { status: "creating_campaign", current_step_detail: "No websites found to scrape - proceeding to campaign creation" });
          logEvent(run.id, "contact_scrape_skipped", `No leads with a website were found in ${run.country} - skipping contact scraping.`);
        } else {
          logEvent(run.id, "contact_scrape_failed", `Could not start contact scraping: ${err.message}`);
        }
      }
      continue;
    }

    const job = db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ?").get(run.country_scrape_job_id);
    if (!job || job.status === "completed" || job.status === "cancelled") {
      updateRun(run.id, { status: "creating_campaign", current_step_detail: "Contact scraping finished - building the campaign" });
      logEvent(run.id, "contact_scrape_completed", `Finished scraping contact details for ${run.country}.`);
      continue;
    }

    // Still running - surface the scraper's own real progress through
    // its cities, same as the search phase's progress bar, rather than
    // a static message that never changes until the whole thing finishes.
    const jobCityIds = JSON.parse(job.catch_log_ids || "[]");
    const totalJobCities = jobCityIds.length;
    if (run.current_city_index !== job.current_index || run.total_cities !== totalJobCities) {
      const currentCatchLogId = jobCityIds[job.current_index];
      const currentCityName = currentCatchLogId ? db.prepare("SELECT name FROM catch_logs WHERE id = ?").get(currentCatchLogId)?.name : null;
      updateRun(run.id, {
        current_city_index: job.current_index,
        total_cities: totalJobCities,
        current_step_detail: currentCityName
          ? `Scraping contacts: city ${job.current_index + 1} of ${totalJobCities} (${currentCityName})`
          : `Scraping contacts: city ${job.current_index + 1} of ${totalJobCities}`,
      });
      if (job.current_index > 0) {
        logEvent(run.id, "contact_scrape_started", `Finished scraping contacts for city ${job.current_index} of ${totalJobCities} in ${run.country}.`);
      }
    }
    // else no change since the last tick - nothing new to report yet
  }
}

// Phase 3: build the campaign with exactly the settings specified -
// A/B/C/ungraded leads only, a randomized tone, the country's mapped
// language, the fixed CTA/WhatsApp links, a closing CTA, and 2
// follow-ups 2 days apart. Uses the account's own configured default
// email template, respecting whatever's already been set up there
// rather than assuming one.
async function advanceCampaignCreation() {
  const activeRuns = db.prepare("SELECT * FROM automation_runs WHERE status = 'creating_campaign'").all();
  for (const run of activeRuns) {
    try {
      const catchLogIds = db.prepare("SELECT id FROM catch_logs WHERE niche_id = ? AND country = ?").all(run.niche_id, run.country).map((r) => r.id);
      const userRow = db.prepare("SELECT default_email_template_key FROM users WHERE id = ?").get(run.user_id);
      const tone = TONES[Math.floor(Math.random() * TONES.length)];
      const language = getLanguageForCountry(run.country);

      const result = createCampaign(run.user_id, {
        name: `${run.niche_name} - ${run.country}`,
        nicheId: run.niche_id,
        catchLogIds,
        fitGrades: ["A", "B", "C", "UNGRADED"],
        emailTemplateKey: userRow?.default_email_template_key || null,
        requireInspection: true,
        tone,
        length: "Short",
        language,
        cta: true,
        meeting: true,
        meetingLink: AUTOMATION_CTA_LINK,
        whatsapp: true,
        whatsappLink: AUTOMATION_WHATSAPP_LINK,
        followupEnabled: true,
        followupMaxCount: 2,
        followupWaitDays: 2,
        confirmLowGrade: true, // no one to review the warning - already scoped to A/B/C/ungraded anyway, so it should never actually be relevant
      });

      if (result.requiresConfirmation) {
        // Shouldn't happen given the fitGrades scoping above, but a
        // defensive fallback rather than silently sending to low-grade
        // leads if this is somehow reached.
        updateRun(run.id, { status: "failed", error: "Campaign creation unexpectedly required low-grade confirmation.", completed_at: new Date().toISOString() });
        logEvent(run.id, "campaign_creation_failed", "Campaign creation unexpectedly required confirmation - stopped rather than guess.");
        continue;
      }

      updateRun(run.id, { status: "starting_campaign", campaign_id: result.campaignId, current_step_detail: `Created campaign with ${result.leadCount} lead(s)` });
      logEvent(run.id, "campaign_created", `Created campaign "${run.niche_name} - ${run.country}" with ${result.leadCount} lead(s) - tone: ${tone}, language: ${language}.`);
    } catch (err) {
      updateRun(run.id, { status: "failed", error: err.message, completed_at: new Date().toISOString() });
      logEvent(run.id, "campaign_creation_failed", `Could not create the campaign: ${err.message}`);
    }
  }
}

// Phase 4: the actual "no human review" moment - flips the freshly
// created draft campaign to running, exactly what clicking Start would
// do manually.
async function advanceCampaignStart() {
  const activeRuns = db.prepare("SELECT * FROM automation_runs WHERE status = 'starting_campaign'").all();
  for (const run of activeRuns) {
    try {
      const campaign = db.prepare("SELECT status FROM email_campaigns WHERE id = ?").get(run.campaign_id);
      if (!campaign) throw new Error("Campaign no longer exists");
      if (campaign.status === "draft") {
        db.prepare("UPDATE email_campaigns SET status = 'running', started_at = datetime('now') WHERE id = ?").run(run.campaign_id);
      }
      updateRun(run.id, { status: "completed", completed_at: new Date().toISOString(), current_step_detail: "Campaign is running" });
      logEvent(run.id, "completed", `Campaign started - "${run.niche_name} - ${run.country}" is now sending automatically.`);
    } catch (err) {
      updateRun(run.id, { status: "failed", error: err.message, completed_at: new Date().toISOString() });
      logEvent(run.id, "campaign_start_failed", `Could not start the campaign: ${err.message}`);
    }
  }
}

async function tick() {
  await maybeStartNewRuns();
  await advanceCitySearches();
  await advanceContactScraping();
  await advanceCampaignCreation();
  await advanceCampaignStart();
}

function startScheduler() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => console.error("[daily-automation] Tick failed:", err.message));
  }, TICK_INTERVAL_MS);
  console.log("[daily-automation] Started - checking every 30s for automation work to advance.");
}

module.exports = {
  startScheduler,
  tick,
  findNextNicheCountryPair,
  canStartNewRunToday,
  logEvent,
  updateRun,
  getRun,
};
