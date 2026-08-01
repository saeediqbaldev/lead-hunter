// Shared client for any OpenAI-compatible chat completions API - Groq and
// DeepSeek both use this exact shape (only the base URL, default model, and
// auth header value differ), so one implementation serves both instead of
// duplicating the same fetch/parse/timeout logic twice.
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    console.log(`[${options.__providerLabel || "openai-compat"}] request completed in ${Date.now() - startedAt}ms (status ${res.status})`);
    return res;
  } catch (err) {
    console.log(`[${options.__providerLabel || "openai-compat"}] request failed after ${Date.now() - startedAt}ms: ${err.name} - ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function createOpenAiCompatibleClient({ label, baseUrl, defaultModel }) {
  async function testApiKey(apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return { ok: false, error: "Enter an API key first." };
    }
    try {
      const res = await fetchWithTimeout(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        __providerLabel: label,
      });
      if (res.ok) return { ok: true };

      const errText = await res.text();
      let message = `${label} rejected the key (HTTP ${res.status}).`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // keep generic message
      }
      return { ok: false, error: message };
    } catch (err) {
      const timedOut = err.name === "AbortError";
      return { ok: false, error: timedOut ? `${label} took too long to respond.` : `Could not reach ${label}: ${err.message}` };
    }
  }

  async function generateText(apiKey, prompt, { jsonMode } = {}) {
    const body = {
      model: defaultModel,
      messages: [{ role: "user", content: prompt }],
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    try {
      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        __providerLabel: label,
      });

      if (!res.ok) {
        const errText = await res.text();
        let message = `${label} returned HTTP ${res.status}.`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          // keep generic message
        }
        return { ok: false, error: message, httpStatus: res.status };
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) return { ok: false, error: `${label} returned an empty response.` };
      return { ok: true, text };
    } catch (err) {
      const timedOut = err.name === "AbortError";
      return { ok: false, error: timedOut ? `${label} took too long to respond - try again.` : `Could not reach ${label}: ${err.message}` };
    }
  }

  return { testApiKey, generateText, label };
}

const groqClient = createOpenAiCompatibleClient({
  label: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  defaultModel: "llama-3.3-70b-versatile",
});

const deepseekClient = createOpenAiCompatibleClient({
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  defaultModel: "deepseek-chat",
});

module.exports = { groqClient, deepseekClient, createOpenAiCompatibleClient };
