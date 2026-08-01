// Thin client for Google's Gemini API (generativelanguage.googleapis.com).
// Used for: the business deep-analysis writeup (strengths/weaknesses/
// suggested services) and the outreach content generator. Both are plain
// text-generation calls - no need for a heavier SDK dependency for this.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Kept deliberately conservative - well under typical reverse-proxy default
// timeouts (commonly 30-60s for nginx/Traefik setups like Coolify uses) so
// THIS timeout fires and returns a clean JSON error before the proxy's own
// timeout can intervene and return an HTML error page instead, which is
// what produces "Unexpected token '<'" on the client (attempting to
// JSON-parse an HTML response).
const REQUEST_TIMEOUT_MS = 20000;

// A plain fetch() with no timeout can hang indefinitely if Gemini is slow
// to respond - and structured JSON-schema generation genuinely can take a
// while. Most reverse proxies (Coolify/Traefik included) kill idle
// connections around 60s, which would cut the request mid-flight and
// surface as a generic connection failure on the client with no useful
// error message. This wraps every Gemini call with an explicit timeout so
// a slow response fails cleanly and quickly instead.
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    console.log(`[gemini] request completed in ${Date.now() - startedAt}ms (status ${res.status})`);
    return res;
  } catch (err) {
    console.log(`[gemini] request failed after ${Date.now() - startedAt}ms: ${err.name} - ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// GET /v1beta/models is a free, lightweight call (lists available models)
// - good enough to validate a key actually works without spending any real
// generation quota, mirroring how testApiKey works for Google Places.
async function testApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: "Enter an API key first." };
  }
  try {
    const res = await fetchWithTimeout(`${GEMINI_BASE}/models`, {
      headers: { "x-goog-api-key": apiKey.trim() },
    });
    if (res.ok) return { ok: true };

    const errText = await res.text();
    let message = `Google rejected the key (HTTP ${res.status}).`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error && parsed.error.message) message = parsed.error.message;
    } catch {
      // keep the generic message above
    }
    return { ok: false, error: message };
  } catch (err) {
    const timedOut = err.name === "AbortError";
    return { ok: false, error: timedOut ? "Timed out waiting for Google's servers." : `Could not reach Google's servers: ${err.message}` };
  }
}

// Generates plain text from a prompt. Returns { ok, text, error }.
// responseSchema (optional) requests structured JSON output directly from
// the model instead of us having to parse free-form text.
async function generateText(apiKey, prompt, { responseSchema } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (responseSchema) {
    body.generationConfig = { responseMimeType: "application/json", responseSchema };
  }

  try {
    const res = await fetchWithTimeout(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      let message = `Gemini returned HTTP ${res.status}.`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) message = parsed.error.message;
      } catch {
        // keep generic message
      }
      return { ok: false, error: message };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, error: "Gemini returned an empty response." };
    return { ok: true, text };
  } catch (err) {
    const timedOut = err.name === "AbortError";
    return { ok: false, error: timedOut ? "Gemini took too long to respond (over 20s) - try again, or try a shorter length setting." : `Could not reach Gemini: ${err.message}` };
  }
}

module.exports = { testApiKey, generateText, GEMINI_MODEL };
