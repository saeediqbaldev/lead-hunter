// Drives a "Scrape All" job across every city (catch log) in a country,
// one at a time - the underlying scraper microservice only supports a
// single active job at once (see scraperService.js), so this is purely
// an orchestration layer on top of it: hold a queue, wait for the
// current city to finish, merge its results, move to the next one.
//
// This is deliberately its own logic rather than a refactor of the
// existing single-catch-log scrape route in catchLogs.js - that route
// was carefully debugged (see the "orphaned job" fix) and reusing it
// directly here would mean either duplicating req/res-shaped code or
// risking that existing, working path. A little logic duplication here
// is the safer trade.

const db = require("./db");
const scraperService = require("./scraperService");
const { buildLeadsQuery } = require("./leadsQuery");

const TICK_INTERVAL_MS = 10000; // 10s - a background check, not a UI-facing poll, so this doesn't need to be as frequent as the frontend's own status polling
let tickTimer = null;

function getActiveJobForNiche(userId, nicheId, country) {
  return db
    .prepare("SELECT * FROM country_scrape_jobs WHERE user_id = ? AND niche_id = ? AND country = ? AND status = 'running'")
    .get(userId, nicheId, country);
}

// Starts a new country-wide scrape - fails if one is already running
// for this user (the scraper is single-job across the whole app, not
// just per-country, so two country jobs from the same or different
// users would collide with each other regardless of country).
async function startCountryScrape(userId, nicheId, country) {
  const anyRunning = db.prepare("SELECT id FROM country_scrape_jobs WHERE status = 'running'").get();
  if (anyRunning) {
    throw new Error("A scrape is already running (this niche, another niche, or another user) - only one can run at a time. Wait for it to finish.");
  }

  const catchLogIds = db
    .prepare("SELECT id FROM catch_logs WHERE niche_id = ? AND country = ?")
    .all(nicheId, country)
    .map((r) => r.id);
  if (!catchLogIds.length) throw new Error("No cities found for this country in this niche.");

  const info = db
    .prepare("INSERT INTO country_scrape_jobs (user_id, niche_id, country, catch_log_ids, current_index, status) VALUES (?, ?, ?, ?, 0, 'running')")
    .run(userId, nicheId, country, JSON.stringify(catchLogIds));
  const jobId = info.lastInsertRowid;

  try {
    await startCurrentCity(db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ?").get(jobId));
  } catch (err) {
    // The very first city failing to start (e.g. no leads with a
    // website there) shouldn't leave an orphaned "running" job behind -
    // skip straight to the next eligible city instead of failing the
    // whole request, same as the periodic tick would do later.
    await advancePastCurrentCity(jobId, err.message);
  }

  return db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ?").get(jobId);
}

// Core "start scraping this one city" logic - the same reset+import+start
// sequence the single-catch-log route uses, just without any Express
// req/res involved. Throws if there's nothing to scrape there (no
// leads with a website), which the caller uses to decide whether to
// skip ahead to the next city.
async function startCurrentCity(job) {
  const catchLogIds = JSON.parse(job.catch_log_ids);
  const catchLogId = catchLogIds[job.current_index];
  const log = db.prepare("SELECT * FROM catch_logs WHERE id = ?").get(catchLogId);
  if (!log) throw new Error(`Catch log ${catchLogId} no longer exists`);

  const { baseQuery, params } = buildLeadsQuery(job.user_id, { catchLogId });
  const leads = db.prepare(`SELECT l.* ${baseQuery} AND l.website IS NOT NULL AND l.website != ''`).all(...params);
  if (leads.length === 0) throw new Error(`No records with a website in "${log.name}"`);

  scraperService.acquireLock(job.user_id, catchLogId, log.name);
  await scraperService.resetScraperWorkingTable();
  await scraperService.importLeadsAsCsv(leads);
  await scraperService.startScrape();
}

// Moves the job to the next city in its queue, skipping over any that
// fail to start (logging why) rather than stalling the whole country
// job over one bad city - reported separately in the job's own error
// field for visibility, but doesn't block the rest of the queue.
async function advancePastCurrentCity(jobId, skipReason) {
  const job = db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ?").get(jobId);
  if (!job || job.status !== "running") return;

  const catchLogIds = JSON.parse(job.catch_log_ids);
  let nextIndex = job.current_index + 1;
  let lastError = skipReason || null;

  while (nextIndex < catchLogIds.length) {
    db.prepare("UPDATE country_scrape_jobs SET current_index = ?, error = ? WHERE id = ?").run(nextIndex, lastError, jobId);
    const refreshed = db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ?").get(jobId);
    try {
      await startCurrentCity(refreshed);
      return; // successfully started - this tick's work is done
    } catch (err) {
      console.error(`[country-scrape] Skipping city (job ${jobId}, index ${nextIndex}):`, err.message);
      lastError = err.message;
      nextIndex++;
    }
  }

  // Ran out of cities - the whole job is done.
  db.prepare("UPDATE country_scrape_jobs SET status = 'completed', completed_at = datetime('now'), error = ? WHERE id = ?").run(lastError, jobId);
}

// Background driver - checks whichever city is currently "in progress"
// for each running job, and if the scraper reports it's no longer busy,
// pulls the results back (same merge step the single-catch-log status
// route does) and advances the queue.
async function tick() {
  const jobs = db.prepare("SELECT * FROM country_scrape_jobs WHERE status = 'running'").all();
  for (const job of jobs) {
    const catchLogIds = JSON.parse(job.catch_log_ids);
    const currentCatchLogId = catchLogIds[job.current_index];
    const lock = scraperService.getLock();
    const isOurs = lock && lock.userId === job.user_id && lock.catchLogId === currentCatchLogId;

    if (!isOurs) {
      // Nothing of ours is locked for this city - either it was never
      // successfully started (shouldn't normally happen given the
      // skip-ahead logic above) or something external cleared the lock.
      // Treat as "needs (re)starting" rather than getting stuck.
      try {
        await startCurrentCity(job);
      } catch (err) {
        await advancePastCurrentCity(job.id, err.message);
      }
      continue;
    }

    try {
      const status = await scraperService.getStatus();
      if (status.job_running) continue; // still working on this city - check again next tick

      const businesses = await scraperService.getScrapedBusinesses();
      const mergedCount = scraperService.mergeScrapedResultsIntoLeads(currentCatchLogId, businesses);
      scraperService.releaseLock();
      db.prepare("UPDATE country_scrape_jobs SET total_merged = total_merged + ? WHERE id = ?").run(mergedCount, job.id);
      await advancePastCurrentCity(job.id, null);
    } catch (err) {
      console.error(`[country-scrape] Failed to poll/merge for job ${job.id}:`, err.message);
      // Leave the lock and job state as-is - a transient network error
      // talking to the scraper shouldn't abandon the whole job, just
      // try again next tick.
    }
  }
}

// Cancels a running job - stops whatever city is currently in progress
// too, not just the queue bookkeeping, so the scraper itself actually
// stops working rather than silently finishing a city nobody's tracking
// anymore.
async function stopCountryScrape(userId, jobId) {
  const job = db.prepare("SELECT * FROM country_scrape_jobs WHERE id = ? AND user_id = ?").get(jobId, userId);
  if (!job || job.status !== "running") return { stopped: false };

  const catchLogIds = JSON.parse(job.catch_log_ids);
  const currentCatchLogId = catchLogIds[job.current_index];
  const lock = scraperService.getLock();
  if (lock && lock.userId === userId && lock.catchLogId === currentCatchLogId) {
    try {
      await scraperService.stopScrape();
    } catch (err) {
      console.error(`[country-scrape] Failed to stop the scraper for job ${jobId}:`, err.message);
    }
    scraperService.releaseLock();
  }

  db.prepare("UPDATE country_scrape_jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?").run(jobId);
  return { stopped: true };
}

function startOrchestrator() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => console.error("[country-scrape] Tick failed:", err));
  }, TICK_INTERVAL_MS);
}

module.exports = { startCountryScrape, stopCountryScrape, getActiveJobForNiche, startOrchestrator, tick };
