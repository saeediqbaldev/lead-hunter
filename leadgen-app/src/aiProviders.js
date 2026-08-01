// Orchestrates calling whichever AI provider is actually available for a
// user, with automatic fallback: if the first provider fails for any
// reason (no key configured, rate-limited, network error, timeout), it
// tries the next one instead of failing the whole request. This is what
// protects against exactly the kind of outage that motivated adding
// Groq/DeepSeek in the first place - Gemini's free tier hitting its daily
// cap, or any single provider having a bad moment.
const apiKeys = require("./apiKeys");
const gemini = require("./gemini");
const { groqClient, deepseekClient } = require("./openaiCompatible");

// Order matters: Groq is tried first (generous recurring free tier + very
// fast responses, which also helps avoid proxy-timeout issues), then
// Gemini (recurring but a much tighter free cap), then DeepSeek last
// (its free access is a one-time token grant per account, not a
// recurring daily quota, so it's the one worth preserving longest).
const PROVIDER_ORDER = ["groq", "gemini", "deepseek"];

const PROVIDER_LABELS = { groq: "Groq", gemini: "Gemini", deepseek: "DeepSeek" };

function getClientFor(provider) {
  if (provider === "gemini") return gemini;
  if (provider === "groq") return groqClient;
  if (provider === "deepseek") return deepseekClient;
  return null;
}

// Returns the ordered list of providers this user actually has an active
// key for - providers with no key configured are skipped entirely rather
// than counted as a "failed attempt".
function availableProviders(userId) {
  return PROVIDER_ORDER.filter((p) => !!apiKeys.getActiveKey(userId, p));
}

// Calls generateText on the given provider, normalizing Gemini's slightly
// different signature (responseSchema) to the same { ok, text, error }
// shape the OpenAI-compatible clients use.
async function callProvider(provider, apiKey, prompt, { jsonMode, geminiSchema } = {}) {
  if (provider === "gemini") {
    return gemini.generateText(apiKey, prompt, geminiSchema ? { responseSchema: geminiSchema } : {});
  }
  const client = getClientFor(provider);
  return client.generateText(apiKey, prompt, { jsonMode });
}

// Tries each available provider in order until one succeeds. Returns
// { ok, text, provider, error, attempts } - attempts is the full list of
// what was tried and why each one failed, useful for surfacing a genuinely
// informative error if every provider fails.
async function generateWithFallback(userId, prompt, { jsonMode, geminiSchema } = {}) {
  const providers = availableProviders(userId);
  if (providers.length === 0) {
    return {
      ok: false,
      error: "No AI provider configured. Add a key for Groq, Gemini, or DeepSeek in Settings.",
      attempts: [],
    };
  }

  const attempts = [];
  for (const provider of providers) {
    const keyRow = apiKeys.getActiveKey(userId, provider);
    const result = await callProvider(provider, keyRow.key_value, prompt, { jsonMode, geminiSchema });
    if (result.ok) {
      apiKeys.recordUsage(userId, keyRow.id, { requests: 1 });
      return { ok: true, text: result.text, provider, attempts: [...attempts, { provider, ok: true }] };
    }
    attempts.push({ provider, ok: false, error: result.error });
    console.log(`[ai-fallback] ${PROVIDER_LABELS[provider]} failed: ${result.error} - trying next provider...`);
  }

  const summary = attempts.map((a) => `${PROVIDER_LABELS[a.provider]}: ${a.error}`).join(" | ");
  return { ok: false, error: `All configured AI providers failed. ${summary}`, attempts };
}

module.exports = { generateWithFallback, availableProviders, PROVIDER_ORDER, PROVIDER_LABELS };
