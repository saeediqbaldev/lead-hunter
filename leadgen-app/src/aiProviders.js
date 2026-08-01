async function generateWithFallback(userId, prompt) {
  await new Promise((r) => setTimeout(r, 50));
  return { ok: true, text: 'Mock content', provider: 'groq' };
}
module.exports = { generateWithFallback };
