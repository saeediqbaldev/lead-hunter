// Generates outreach content (cold email, social DMs) for a lead, using
// whatever business-analysis data is available as grounding context so the
// message references real, specific findings rather than generic filler.
const { generateText } = require("./gemini");

const SIGNATURE = `Kind Regards,
   Saeed Iqbal
   Ceo | Xeven Pixels
   https://xevenpixels.com
   contact@xevenpixels.com`;

const TONES = [
  "Personalized Observation",
  "Problem → Solution",
  "Compliment + Opportunity",
  "Curiosity / Pattern Interrupt",
  "Case Study / Social Proof",
  "Value-First / Free Audit",
  "Question-Based Conversation",
];

const PLATFORM_GUIDANCE = {
  email: "Format as a cold email with a short subject line (prefixed 'Subject:') and a body. Can be a few short paragraphs.",
  facebook: "Format as a Facebook Page message - conversational, 3-5 sentences, no subject line.",
  instagram: "Format as an Instagram DM - short, casual, friendly, 2-4 sentences, no subject line.",
  linkedin: "Format as a LinkedIn connection/message - professional but warm, 3-5 sentences, no subject line.",
  tiktok: "Format as a TikTok DM - very short, casual, energetic, 2-3 sentences, no subject line.",
  whatsapp: "Format as a WhatsApp message - short, friendly, conversational, 2-4 sentences, no subject line.",
};

function buildContentPrompt({ lead, platform, tone, analysis }) {
  const platformGuidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.email;

  let context = `Business: ${lead.name}\nCategory: ${lead.niche_name || "local business"}\nLocation: ${lead.city_name || lead.address || "unknown"}`;

  if (analysis && analysis.status === "done") {
    if (analysis.strengths?.length) context += `\n\nKnown strengths: ${analysis.strengths.join("; ")}`;
    if (analysis.weaknesses?.length) context += `\nKnown weaknesses/opportunities: ${analysis.weaknesses.join("; ")}`;
    if (analysis.suggestedServices?.length) context += `\nRelevant services to mention: ${analysis.suggestedServices.join("; ")}`;
  } else {
    context += `\n\n(No deep analysis has been run yet for this business - keep the message general but still personalized to their industry and location.)`;
  }

  return `You are writing outreach copy on behalf of a marketing agency (Xeven Pixels), reaching out to a local business to offer to help them grow.

${context}

Tone/approach to use: "${tone}"
${platformGuidance}

Write the message now. Requirements:
- Professional, humanized, natural-sounding - not generic template language a business owner would recognize as spam
- Reference the specific context above where relevant (don't invent facts not given)
- Include one strong, clear call-to-action line near the end (e.g. suggesting a short call or reply)
- Do NOT include a signature or sign-off - that will be added separately
- Output ONLY the message content itself, nothing else (no preamble, no explanation)`;
}

async function generateOutreachContent(apiKey, { lead, platform, tone, analysis }) {
  const prompt = buildContentPrompt({ lead, platform, tone, analysis });
  const result = await generateText(apiKey, prompt);
  if (!result.ok) return result;

  const content = `${result.text.trim()}\n\n${SIGNATURE}`;
  return { ok: true, content };
}

module.exports = { TONES, PLATFORM_GUIDANCE, SIGNATURE, buildContentPrompt, generateOutreachContent };
