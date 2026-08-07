// Generates outreach content (cold email, social DMs) for a lead, using
// whatever business-analysis data is available as grounding context so the
// message references real, specific findings rather than generic filler.
// Uses the AI provider fallback chain (Groq -> Gemini -> DeepSeek) instead
// of calling one provider directly, so a single provider being rate-limited
// or briefly down doesn't fail the whole request.
const { generateWithFallback } = require("./aiProviders");

// Signature is now a per-user setting (Account Settings -> Signature),
// not hardcoded - this default only applies if a user somehow has no
// signature saved at all (shouldn't normally happen, since the DB column
// has a default value applied via migration).
const DEFAULT_SIGNATURE = "Kind Regards,\n   Saeed Iqbal\n   Ceo | Xeven Pixels\n   https://xevenpixels.com\n   contact@xevenpixels.com";

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
  email: "Format as a cold email body only (no subject line here - that's generated separately). Can be a few short paragraphs.",
  facebook: "Format as a Facebook Page message - conversational, 3-5 sentences, no subject line.",
  instagram: "Format as an Instagram DM - short, casual, friendly, 2-4 sentences, no subject line.",
  linkedin: "Format as a LinkedIn connection/message - professional but warm, 3-5 sentences, no subject line.",
  tiktok: "Format as a TikTok DM - very short, casual, energetic, 2-3 sentences, no subject line.",
  whatsapp: "Format as a WhatsApp message - short, friendly, conversational, 2-4 sentences, no subject line.",
};

const LENGTH_GUIDANCE = {
  Detailed: "Write a detailed, thorough message - several sentences or short paragraphs, covering the context fully.",
  Medium: "Write a medium-length message - a few sentences, balanced between brief and thorough.",
  Short: "Write a short message - 2-3 sentences at most, get to the point quickly.",
  Concise: "Write an extremely concise message - 1-2 sentences total, as brief as possible while still being complete and natural.",
};

const LANGUAGES = ["English", "French", "Spanish", "German", "Portuguese", "Arabic", "Chinese", "Hebrew", "Hungarian", "Russian", "Italian", "Bengali", "Urdu", "Pashto"];

function buildContentPrompt({ lead, platform, tone, length, analysis, language, cta, meeting, meetingLink, website, websiteLink }) {
  const platformGuidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.email;
  const lengthGuidance = LENGTH_GUIDANCE[length] || "";
  const languageInstruction =
    language && language !== "English" ? `\nWrite the ENTIRE message in ${language} - not English, ${language}. The signature will be added separately in its original form, so don't worry about that part.` : "";

  let context = `Business: ${lead.name}\nCategory: ${lead.niche_name || "local business"}\nLocation: ${lead.city_name || lead.address || "unknown"}`;

  if (analysis && analysis.status === "done") {
    if (analysis.strengths?.length) context += `\n\nKnown strengths: ${analysis.strengths.join("; ")}`;
    if (analysis.weaknesses?.length) context += `\nKnown weaknesses/opportunities: ${analysis.weaknesses.join("; ")}`;
    if (analysis.suggestedServices?.length) context += `\nRelevant services to mention: ${analysis.suggestedServices.join("; ")}`;
  } else {
    context += `\n\n(No deep analysis has been run yet for this business - keep the message general but still personalized to their industry and location.)`;
  }

  // Each of these is an opt-in toggle the user picks per generation - only
  // included in the prompt when actually enabled, so the AI isn't told to
  // juggle three extra asks it wasn't asked to include.
  const extraInstructions = [];
  if (cta) {
    extraInstructions.push(
      "Include a clear, specific call-to-action woven naturally into the message (not a generic \"let's connect\") - give the reader one obvious, low-friction next step."
    );
  }
  if (meeting) {
    extraInstructions.push(
      meetingLink
        ? `Naturally invite them to a short meeting/call, and organically include this link for booking one: ${meetingLink} - don't just paste it in isolation, weave it into a sentence.`
        : "Naturally invite them to a short meeting or call as part of the message - phrase it as a low-pressure invitation, not a demand."
    );
  }
  if (website) {
    extraInstructions.push(
      websiteLink
        ? `Organically mention that a demo/reference website has been put together for them to see the kind of quality to expect, and include this link naturally in a sentence: ${websiteLink}`
        : "Organically mention that a demo or reference website example is available to show the kind of quality/style to expect, without inventing a specific URL since none was given."
    );
  }
  const extraSection = extraInstructions.length ? `\n\nAlso work these in naturally, without making the message feel like a checklist:\n${extraInstructions.map((s) => `- ${s}`).join("\n")}` : "";

  return `You are writing outreach copy on behalf of a marketing agency (Xeven Pixels), reaching out to a local business to offer to help them grow.

${context}

Tone/approach to use: "${tone}"
${platformGuidance}
${lengthGuidance ? `Length: ${lengthGuidance}` : ""}${languageInstruction}${extraSection}

Write the message now. Requirements:
- Professional, humanized, natural-sounding - not generic template language a business owner would recognize as spam
- Reference the specific context above where relevant (don't invent facts not given)
- End with a natural closing line appropriate to the message${extraInstructions.length ? " (working in the items listed above)" : " (a soft, low-pressure call-to-action)"}
- Do NOT include a signature or sign-off - that will be added separately
- Plain text only - no markdown formatting of any kind (no **asterisks** for bold, no _underscores_ for italics, no # headers, no markdown links). Write it exactly as it should be read, since this goes straight into an email/DM with no markdown rendering.
- Output ONLY the message content itself, nothing else (no preamble, no explanation)`;
}

function buildSubjectPrompt({ lead, tone, language, body }) {
  const languageInstruction = language && language !== "English" ? ` Write it in ${language}.` : "";
  return `Write ONE short cold-email subject line for this outreach email, in the same "${tone}" tone/approach.${languageInstruction}

Business being contacted: ${lead.name} (${lead.niche_name || "local business"})
Email body it's paired with:
${body}

Requirements:
- Under 8 words, no clickbait, no spam-trigger phrases ("Free!!!", ALL CAPS, excessive punctuation)
- Specific to this business, not generic ("Quick question", "Following up")
- Plain text only, no markdown, no quotation marks around it
- Output ONLY the subject line itself, nothing else`;
}

async function generateOutreachContent(userId, { lead, platform, tone, length, analysis, signature, language, aiProvider, cta, meeting, meetingLink, website, websiteLink }) {
  const prompt = buildContentPrompt({ lead, platform, tone, length, analysis, language, cta, meeting, meetingLink, website, websiteLink });
  const result = await generateWithFallback(userId, prompt, { onlyProvider: aiProvider || undefined });
  if (!result.ok) return result;

  const sig = signature != null && signature !== "" ? signature : DEFAULT_SIGNATURE;
  const bodyText = result.text.trim();

  if (platform === "email") {
    const subjectResult = await generateWithFallback(userId, buildSubjectPrompt({ lead, tone, language, body: bodyText }), {
      onlyProvider: aiProvider || undefined,
    });
    const subject = subjectResult.ok ? subjectResult.text.trim().replace(/^["']|["']$/g, "") : `A quick idea for ${lead.name}`;
    const content = `${bodyText}\n\n${sig}`;
    return { ok: true, content, subject, provider: result.provider };
  }

  const content = `${bodyText}\n\n${sig}`;
  return { ok: true, content, provider: result.provider };
}

async function generateSubjectOnly(userId, { lead, tone, language, body, aiProvider }) {
  const result = await generateWithFallback(userId, buildSubjectPrompt({ lead, tone, language, body }), { onlyProvider: aiProvider || undefined });
  if (!result.ok) return result;
  return { ok: true, subject: result.text.trim().replace(/^["']|["']$/g, ""), provider: result.provider };
}

const LENGTHS = ["Detailed", "Medium", "Short", "Concise"];

const PLATFORM_LIST = ["email", "facebook", "instagram", "linkedin", "tiktok", "whatsapp"];

module.exports = { TONES, LENGTHS, LANGUAGES, PLATFORM_LIST, PLATFORM_GUIDANCE, DEFAULT_SIGNATURE, buildContentPrompt, generateOutreachContent, generateSubjectOnly };
