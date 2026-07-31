// Thin client for Google's Gemini API (generativelanguage.googleapis.com).
// Used for: the business deep-analysis writeup (strengths/weaknesses/
// suggested services) and the outreach content generator. Both are plain
// text-generation calls - no need for a heavier SDK dependency for this.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// GET /v1beta/models is a free, lightweight call (lists available models)
// - good enough to validate a key actually works without spending any real
// generation quota, mirroring how testApiKey works for Google Places.
async function testApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: "Enter an API key first." };
  }
  try {
    const res = await fetch(`${GEMINI_BASE}/models`, {
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
    return { ok: false, error: `Could not reach Google's servers: ${err.message}` };
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
    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
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
    return { ok: false, error: `Could not reach Gemini: ${err.message}` };
  }
}

module.exports = { testApiKey, generateText, GEMINI_MODEL };
