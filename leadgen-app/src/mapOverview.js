// Backend logic for the Reports > Map Overview page: maps this app's
// own country name strings to the exact names used in the world-atlas
// TopoJSON boundary data, and computes per-country lead funnel stats.

const db = require("./db");

// Only the real mismatches between this app's own country name strings
// (catch_logs.country, topCitiesByCountry.js) and world-atlas's naming -
// every other country name matches exactly between the two.
const WORLD_ATLAS_NAME_OVERRIDES = {
  "United States": "United States of America",
  "Czech Republic": "Czechia",
};

function toWorldAtlasName(country) {
  return WORLD_ATLAS_NAME_OVERRIDES[country] || country;
}

// Funnel stages, in order: new -> shortlisted -> contacted -> engaged ->
// converted/won (rejected is a terminal "out" state that can happen at
// any stage). Each metric below is a CUMULATIVE count - "contacted"
// means "has reached at least the contacted stage", not "is sitting
// exactly at contacted status right now". A lead that has since moved
// on to "won" was still, undeniably, contacted - a strict single-status
// count would misleadingly drop it from that number the moment it
// progresses, making the funnel look like it's shrinking rather than
// showing a lead's furthest-reached stage.
const CONTACTED_OR_LATER = ["contacted", "engaged", "converted", "won"];
const ENGAGED_OR_LATER = ["engaged", "converted", "won"];
const CONVERTED_STATUSES = ["converted", "won"];

// Returns, for every country that has at least one catch log (i.e. has
// actually been hunted), the funnel counts the Map Overview page needs:
// total leads scraped, and how many have reached each further stage.
function getCountryFunnelStats(userId) {
  const rows = db
    .prepare(
      `SELECT
         cl.country AS country,
         COUNT(*) AS leads_scraped,
         SUM(CASE WHEN l.status IN (${CONTACTED_OR_LATER.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN l.status IN (${ENGAGED_OR_LATER.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS engaged,
         SUM(CASE WHEN l.status IN (${CONVERTED_STATUSES.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS converted
       FROM leads l
       JOIN catch_logs cl ON cl.id = l.catch_log_id
       JOIN niches n ON n.id = cl.niche_id
       WHERE n.user_id = ? AND cl.country IS NOT NULL AND cl.country != '' AND cl.country != 'Unnamed'
       GROUP BY cl.country`
    )
    .all(...CONTACTED_OR_LATER, ...ENGAGED_OR_LATER, ...CONVERTED_STATUSES, userId);

  return rows.map((r) => ({
    country: r.country,
    worldAtlasName: toWorldAtlasName(r.country),
    leadsScraped: r.leads_scraped,
    contacted: r.contacted,
    engaged: r.engaged,
    converted: r.converted,
  }));
}

// Per-city funnel stats, one row per catch log (hunted city) that has
// at least one lead with real coordinates - a city's marker position is
// the centroid (simple average) of its own leads' actual Places API
// coordinates, not a guessed or looked-up city center. A catch log
// searched before coordinate capture existed has no geocoded leads yet
// and is honestly left out here, rather than plotted somewhere
// misleading - it starts appearing once it's searched again.
function getCityFunnelStats(userId) {
  const rows = db
    .prepare(
      `SELECT
         cl.id AS catch_log_id,
         cl.name AS city_name,
         cl.country AS country,
         AVG(l.lat) AS lat,
         AVG(l.lng) AS lng,
         COUNT(*) AS leads_scraped,
         SUM(CASE WHEN l.status IN (${CONTACTED_OR_LATER.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN l.status IN (${ENGAGED_OR_LATER.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS engaged,
         SUM(CASE WHEN l.status IN (${CONVERTED_STATUSES.map(() => "?").join(",")}) THEN 1 ELSE 0 END) AS converted
       FROM leads l
       JOIN catch_logs cl ON cl.id = l.catch_log_id
       JOIN niches n ON n.id = cl.niche_id
       WHERE n.user_id = ? AND l.lat IS NOT NULL AND l.lng IS NOT NULL
         AND cl.country IS NOT NULL AND cl.country != '' AND cl.country != 'Unnamed'
       GROUP BY cl.id`
    )
    .all(...CONTACTED_OR_LATER, ...ENGAGED_OR_LATER, ...CONVERTED_STATUSES, userId);

  return rows.map((r) => ({
    catchLogId: r.catch_log_id,
    city: r.city_name,
    country: r.country,
    lat: r.lat,
    lng: r.lng,
    leadsScraped: r.leads_scraped,
    contacted: r.contacted,
    engaged: r.engaged,
    converted: r.converted,
  }));
}

module.exports = { toWorldAtlasName, getCountryFunnelStats, getCityFunnelStats, WORLD_ATLAS_NAME_OVERRIDES };
