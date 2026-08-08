const { UAParser } = require("ua-parser-js");
const fetch = require("node-fetch");

// Extracts browser/OS/device from a user-agent string - purely local,
// synchronous, no external service involved.
function parseUserAgent(userAgent) {
  if (!userAgent) return { browser: null, os: null, device: null };
  try {
    const result = new UAParser(userAgent).getResult();
    const browser = result.browser?.name ? `${result.browser.name}${result.browser.version ? " " + result.browser.version : ""}` : null;
    const os = result.os?.name ? `${result.os.name}${result.os.version ? " " + result.os.version : ""}` : null;
    const device = result.device?.model
      ? `${result.device.vendor ? result.device.vendor + " " : ""}${result.device.model}`
      : result.device?.type
      ? result.device.type
      : "Desktop";
    return { browser, os, device };
  } catch {
    return { browser: null, os: null, device: null };
  }
}

// City/country lookup requires an external IP geolocation service - this
// is NOT something that can be done purely locally the way UA parsing
// can. Uses ip-api.com's free, keyless endpoint. IMPORTANT: ip-api.com's
// free tier is documented as non-commercial use only - this app is a
// commercial tool, so before relying on this in production, either
// confirm current terms allow it or switch to a paid geolocation
// provider (most require the same simple {city, country} JSON shape,
// so swapping the URL below is normally all that's needed).
const GEOIP_ENDPOINT = (ip) => `http://ip-api.com/json/${ip}?fields=status,city,country`;

async function lookupGeoIp(ip) {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(GEOIP_ENDPOINT(ip), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "success") return null;
    return { city: data.city || null, country: data.country || null };
  } catch {
    return null; // network hiccup or timeout - not worth failing the tracking hit over
  }
}

module.exports = { parseUserAgent, lookupGeoIp };
