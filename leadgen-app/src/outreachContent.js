// Generates outreach content (cold email, social DMs) for a lead, using
// whatever business-analysis data is available as grounding context so the
// message references real, specific findings rather than generic filler.
// Uses the AI provider fallback chain (Groq -> Gemini -> DeepSeek) instead
// of calling one provider directly, so a single provider being rate-limited
// or briefly down doesn't fail the whole request.
const { generateWithFallback } = require("./aiProviders");
const { DEFAULT_SIGNATURE_FONT_FAMILY, DEFAULT_SIGNATURE_FONT_SIZE } = require("./signatureFonts");

// Injected into every content-generation prompt below (pitch, subject,
// follow-up) - the goal is copy that reads like a real person wrote it
// quickly, not something visibly AI-generated. Called out specifically
// since these are the most common, recognizable tells.
const HUMANIZE_INSTRUCTION = `
Write like a real person sent this in a couple of minutes, not like an AI wrote it. Concretely:
- Keep sentences short and simple. Break up anything that would run more than about 20 words into two sentences.
- Never use an em dash (—) or en dash (–). Use a period, comma, or "and"/"but" instead.
- Skip AI-sounding phrases and cliches: "unlock", "elevate", "seamless", "dive into", "in today's fast-paced world", "game-changer", "it's worth noting", "furthermore", "moreover", "in the realm of", "take it to the next level".
- Don't open with a rhetorical question or a grand statement. Just say the thing.
- Contractions are fine and often better ("you're" not "you are").`;

// Signature is now a per-user setting (Account Settings -> Signature),
// not hardcoded - this default only applies if a user somehow has no
// signature saved at all (shouldn't normally happen, since the DB column
// has a default value applied via migration).
const DEFAULT_SIGNATURE = `Thank you for your time and consideration.<br><br>Kind Regards,<br>&nbsp;&nbsp;&nbsp;<b>Saeed Iqbal</b><br>&nbsp;&nbsp;&nbsp;Ceo | Xeven Pixels<br>&nbsp;&nbsp;&nbsp;<a href="https://xevenpixels.com">https://xevenpixels.com</a><br>&nbsp;&nbsp;&nbsp;contact@xevenpixels.com`;

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

// Strips common legal/corporate suffixes (LLC, Inc, GmbH, Ltd, Co, Corp,
// etc. across a few languages) and trims an overly long name down to a
// reasonable few words, so "Hartmann Dachdeckerbetrieb GmbH & Co. KG"
// becomes "Hartmann Dachdeckerbetrieb" - a name a salutation can actually
// use, rather than either the full legal mouthful or an impersonal "Hi
// there". This is only the fallback for when no owner name is on file.
function computeBusinessShortName(fullName) {
  if (!fullName) return "there";
  let name = fullName;
  // Run twice - "GmbH & Co. KG" needs both GmbH and KG stripped, and a
  // single pass can leave the second suffix behind if they're adjacent.
  for (let i = 0; i < 2; i++) {
    name = name.replace(
      /\b(LLC|L\.L\.C\.|Inc\.?|Incorporated|Ltd\.?|Limited|Corp\.?|Corporation|Co\.?|Company|GmbH|KG|OHG|e\.?K\.?|PartG|AG|SARL|SRL|BV|Pty\.?\s*Ltd\.?)\b\.?/gi,
      ""
    );
  }
  // Removing suffixes can leave orphaned connector punctuation behind
  // (e.g. "Smith & Co. KG" -> "Smith &  " once the suffixes are gone) -
  // rather than trying to regex-clean just the trailing end (which misses
  // orphans left in the middle, and can't account for truncation below
  // creating a NEW trailing artifact), filter to words that contain at
  // least one letter/number, dropping pure-punctuation leftovers entirely.
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const shortWords = words.length > 4 ? words.slice(0, 4) : words;
  const result = shortWords.join(" ").trim();
  return result || fullName;
}

function buildContentPrompt({ lead, platform, tone, length, analysis, language, cta, meeting, meetingLink, website, websiteLink, whatsapp, whatsappLink }) {
  const platformGuidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.email;
  const lengthGuidance = LENGTH_GUIDANCE[length] || "";
  const languageInstruction =
    language && language !== "English" ? `\nWrite the ENTIRE message in ${language} - not English, ${language}. The signature will be added separately in its original form, so don't worry about that part.` : "";

  const salutationName = lead.owner_name?.trim() || computeBusinessShortName(lead.name);

  let context = `Business: ${lead.name}\nAddress them as: ${salutationName}${lead.owner_name?.trim() ? " (the owner's actual name - use it directly, e.g. \"Hi Sarah\")" : " (no owner name on file, so this is a shortened version of the business name, not a person - phrase the opening accordingly, e.g. \"Hi there\" or naturally naming the business rather than a fake personal greeting)"}\nCategory: ${lead.niche_name || "local business"}\nLocation: ${lead.city_name || lead.address || "unknown"}`;

  if (analysis && analysis.status === "done") {
    if (analysis.strengths?.length) context += `\n\nKnown strengths: ${analysis.strengths.join("; ")}`;
    if (analysis.weaknesses?.length) {
      // SSL/HTTPS issues are common, low-stakes, and easy to over-index on
      // since they're simple for the analysis pipeline to detect - but
      // they rarely move a business owner emotionally the way a real
      // growth/revenue problem does. De-prioritized here rather than
      // dropped entirely, since it's still valid supporting context.
      const nonSslWeaknesses = analysis.weaknesses.filter((w) => !/\bssl\b|\bhttps?\b/i.test(w));
      const sslWeaknesses = analysis.weaknesses.filter((w) => /\bssl\b|\bhttps?\b/i.test(w));
      if (nonSslWeaknesses.length) context += `\nKnown weaknesses/opportunities (lead with these): ${nonSslWeaknesses.join("; ")}`;
      if (sslWeaknesses.length) context += `\nMinor technical findings (mention only in passing if at all, never as the main hook - these rarely matter to a business owner the way a real growth problem does): ${sslWeaknesses.join("; ")}`;
    }
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
  if (whatsapp && whatsappLink) {
    extraInstructions.push(
      `Also offer WhatsApp as a quick, informal way to reach out, and include this link naturally: ${whatsappLink} - phrase it as a separate, distinct option from any meeting link (e.g. "or if it's easier, message me on WhatsApp: ${whatsappLink}"), never placed directly next to another link with no separating words, since that breaks both links.`
    );
  }
  const extraSection = extraInstructions.length ? `\n\nAlso work these in naturally, without making the message feel like a checklist:\n${extraInstructions.map((s) => `- ${s}`).join("\n")}` : "";
  // Both links get their own dedicated instruction above, but this is
  // the one rule that actually matters for correctness, independent of
  // anything else the AI does with the surrounding prose: two raw URLs
  // placed back-to-back with no separating text or punctuation between
  // them will merge into a single broken link when the click-tracking
  // rewriter's URL regex runs on it later, since the regex has no way to
  // know where one link ends and the next begins without whitespace.
  const linkSeparationRule =
    meeting && meetingLink && whatsapp && whatsappLink
      ? "\n\nCRITICAL: never place the meeting link and the WhatsApp link directly adjacent to each other with no words or punctuation in between - always separate them with at least a few words of normal sentence text, ideally in different sentences entirely."
      : "";

  return `You are writing outreach copy on behalf of a marketing agency (Xeven Pixels), reaching out to a local business to offer to help them grow.

${context}

Tone/approach to use: "${tone}"
${platformGuidance}
${lengthGuidance ? `Length: ${lengthGuidance}` : ""}${languageInstruction}${extraSection}${linkSeparationRule}

Write the message now. Requirements:
- Open by addressing them as instructed above - warm and human, not a form-letter salutation
- Sound like a real person who looked at their specific business, not a template - write the way you'd actually talk to someone, with genuine warmth and a bit of personality, not stiff "corporate outreach" phrasing
- Lead with THEIR problem or opportunity, not your pitch - frame it around what it costs them to leave it as-is or what they stand to gain, before mentioning what you'd do about it
- Where it fits naturally, ground the pitch in a concrete number or figure (a realistic industry benchmark, a plausible percentage, a rough time/cost estimate) rather than vague claims like "more customers" or "better results" - specific numbers read as credible and human, not like padding
- Reference the specific context above where relevant (don't invent facts not given, and don't fabricate statistics about THIS business specifically - general industry figures are fine, made-up specifics about them are not)
- End with a clear call-to-action as an actual question or specific ask (e.g. "Worth a quick call this week?" or "Want me to send over a couple of examples?") - not a vague trail-off like "let me know your thoughts."${extraInstructions.length ? " Work in the items listed above too." : ""}
${HUMANIZE_INSTRUCTION}
- Never write a sign-off, closing salutation, or the sender's name anywhere in the message (no "Best regards," no "Thanks,", no name at the end) - the real signature is always appended separately after this. The message ends right after its final sentence/question, nothing else.
- Never use a placeholder in brackets like [Your Name], [Company Name], or similar - if you don't know a specific detail, don't reference it at all rather than leaving a placeholder. A placeholder reaching a real recipient looks broken, not just incomplete.
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
- Never use an em dash (—) or en dash (–)
- Sound like a real person typed it fast, not like an AI wrote it - skip cliches like "unlock", "elevate", "game-changer"
- Output ONLY the subject line itself, nothing else`;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Safety net for the em-dash/en-dash instruction above - a prompt rule
// reduces the risk but can't guarantee the AI never uses one. Handles
// both the common " — " (spaced) form and a bare word—word form,
// falling back to a plain comma for anything else so a stray dash never
// reaches the recipient regardless of how it was used.
function stripAiDashes(text) {
  if (!text) return text;
  return text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/([^\s])[—–]([^\s])/g, "$1, $2")
    .replace(/[—–]/g, ",");
}

// Safety net for the "never sign off, never use a placeholder" rules
// above - a prompt instruction reduces the risk but can't guarantee the
// AI never falls back to something like "Best, [Your Name]" out of habit
// since it doesn't know the sender's real name. A placeholder reaching a
// real recipient looks broken, not just incomplete, so this is treated
// with the same seriousness as the em-dash/link safety nets above.
function stripAiPlaceholderSignoff(text) {
  if (!text) return text;
  let result = text;

  // A trailing sign-off phrase (with or without its own line break)
  // immediately followed by a bracket placeholder, anywhere at the very
  // end of the message - e.g. "Best regards,\n[Your Name]" or "Thanks,
  // [Company Name]". Removed entirely, since the real signature is
  // always appended separately and this whole line shouldn't exist.
  result = result.replace(
    /\n?[ \t]*(best regards|kind regards|warm regards|warmest regards|best|regards|sincerely|warmly|thanks|thank you|cheers|talk soon|looking forward)[,.]?[ \t]*\n?[ \t]*\[[^\]\n]{1,50}\]\s*$/i,
    ""
  );

  // Any remaining stray placeholder elsewhere in the text, targeted at
  // actual placeholder wording (name/company/insert-style) rather than
  // any bracketed text whatsoever - a broader rule would risk mangling
  // legitimate bracketed content that has nothing to do with a
  // placeholder, like "[A/B testing]" mentioned as a real term.
  result = result.replace(/\[[^\]\n]{0,10}(your\s+name|your\s+company|company\s+name|business\s+name|sender'?s?\s+name|recipient'?s?\s+name|insert\s+name|name\s+here|first\s+name|last\s+name)[^\]\n]{0,10}\]/gi, "");
  result = result.replace(/[ \t]{2,}/g, " ");

  return result.trim();
}

// The prompt instructions above reduce the risk of the AI mangling or
// dropping a link, but can't guarantee it - this is what actually
// guarantees it: checks whether each expected link appears intact in the
// generated text (not just present as a substring - a merged URL like
// "...15minhttps://wa.me/..." still technically contains the first link's
// characters, so a boundary check is required, not a plain substring
// match), and if the AI dropped it or merged it into another URL,
// appends it cleanly on its own line instead of trusting whatever the AI
// produced.
function ensureLinksPresent(bodyText, links) {
  let result = bodyText;
  for (const { label, url } of links) {
    if (!url) continue;
    // Same boundary character class the click-tracking rewriter's own
    // URL regex uses downstream (src/campaignEmailBuilder.js), plus the
    // common trailing punctuation it separately strips off afterward
    // (a period ending a sentence right after a URL is completely
    // normal and handled correctly there) - the link only counts as
    // "not intact" if it's immediately followed by something that would
    // actually merge with it, like another URL's characters.
    const intactPattern = new RegExp(`${escapeRegExp(url)}(?![^\\s<>")\\.,;:!?\\]])`);
    if (intactPattern.test(result)) continue;
    result += `\n\n${label}: ${url}`;
  }
  return result;
}

// Wraps a signature in its font styling at the point of use, rather than
// baking the styling into what's actually saved - keeps the stored
// signature HTML itself clean, and avoids the fragility of a wrapping
// style element that "Edit raw HTML" mode could strip out entirely.
function wrapSignatureWithFont(signatureHtml, fontFamily, fontSize) {
  const family = fontFamily || DEFAULT_SIGNATURE_FONT_FAMILY;
  const size = fontSize || DEFAULT_SIGNATURE_FONT_SIZE;
  return `<div style="font-family: ${family}; font-size: ${size}px;">${signatureHtml}</div>`;
}

async function generateOutreachContent(
  userId,
  { lead, platform, tone, length, analysis, signature, signatureFontFamily, signatureFontSize, language, aiProvider, cta, meeting, meetingLink, website, websiteLink, whatsapp, whatsappLink }
) {
  const prompt = buildContentPrompt({ lead, platform, tone, length, analysis, language, cta, meeting, meetingLink, website, websiteLink, whatsapp, whatsappLink });
  const result = await generateWithFallback(userId, prompt, { onlyProvider: aiProvider || undefined });
  if (!result.ok) return result;

  const signatureHtml = wrapSignatureWithFont(signature != null && signature !== "" ? signature : DEFAULT_SIGNATURE, signatureFontFamily, signatureFontSize);
  const bodyText = ensureLinksPresent(stripAiPlaceholderSignoff(stripAiDashes(result.text.trim())), [
    { label: "Book a time", url: meeting ? meetingLink : null },
    { label: "WhatsApp", url: whatsapp ? whatsappLink : null },
    { label: "See an example", url: website ? websiteLink : null },
  ]);

  if (platform === "email") {
    const subjectResult = await generateWithFallback(userId, buildSubjectPrompt({ lead, tone, language, body: bodyText }), {
      onlyProvider: aiProvider || undefined,
    });
    const subject = subjectResult.ok ? stripAiDashes(subjectResult.text.trim().replace(/^["']|["']$/g, "")) : `A quick idea for ${lead.name}`;
    return { ok: true, content: bodyText, signatureHtml, subject, provider: result.provider };
  }

  return { ok: true, content: bodyText, signatureHtml, provider: result.provider };
}

async function generateSubjectOnly(userId, { lead, tone, language, body, aiProvider }) {
  const result = await generateWithFallback(userId, buildSubjectPrompt({ lead, tone, language, body }), { onlyProvider: aiProvider || undefined });
  if (!result.ok) return result;
  return { ok: true, subject: stripAiDashes(result.text.trim().replace(/^["']|["']$/g, "")), provider: result.provider };
}

// A follow-up needs fundamentally different instructions than the
// original pitch: short, references the prior email without repeating
// it, and doesn't re-explain the business's problem from scratch (the
// prospect already read that once). Kept as its own prompt/function
// rather than adding more branches to the main pitch generator above.
function buildFollowUpPrompt({ lead, tone, language, previousBody, touchNumber, analysis, meeting, meetingLink, whatsapp, whatsappLink, customInstructions }) {
  const languageInstruction =
    language && language !== "English" ? `\nWrite the ENTIRE message in ${language} - not English, ${language}.` : "";
  const salutationName = lead.owner_name?.trim() || computeBusinessShortName(lead.name);
  const ordinal = touchNumber === 2 ? "first" : "previous";

  // Escalates by touch rather than staying flat - a 2nd-touch bump reads
  // very differently from a 4th-touch one in any real outreach sequence,
  // and treating them the same misses what the person actually asked for
  // ("the followups should show urgency").
  const urgencyGuidance =
    touchNumber <= 2
      ? "Light, low-pressure nudge - no urgency language yet, just a gentle bump."
      : touchNumber === 3
      ? "A bit more direct - it's been a couple of tries with no response, so add mild urgency (e.g. referencing that the offer/availability won't be open-ended) without sounding pushy or desperate."
      : "This is a later follow-up - be direct about it being one of the last check-ins, with real (but not exaggerated or false) urgency, while staying respectful and leaving the door open.";

  const painPointLine =
    analysis?.status === "done" && analysis.weaknesses?.length
      ? `\n\nThe specific problem(s) worth pointing back at: ${analysis.weaknesses.filter((w) => !/\bssl\b|\bhttps?\b/i.test(w)).join("; ") || analysis.weaknesses.join("; ")}`
      : "";

  const linkInstructions = [];
  if (meeting && meetingLink) linkInstructions.push(`If it fits naturally, include this link for booking a quick call: ${meetingLink}`);
  if (whatsapp && whatsappLink) linkInstructions.push(`If it fits naturally, offer WhatsApp as a faster way to reach out: ${whatsappLink}`);
  const linkSection = linkInstructions.length ? `\n\n${linkInstructions.join("\n")}` : "";
  const linkSeparationRule =
    meeting && meetingLink && whatsapp && whatsappLink
      ? "\n\nCRITICAL: never place the meeting link and the WhatsApp link directly adjacent to each other with no words or punctuation in between."
      : "";

  const customSection = customInstructions?.trim() ? `\n\nAdditional instructions from the sender for this follow-up specifically:\n${customInstructions.trim()}` : "";

  return `Write a short, natural follow-up email to a business that hasn't replied to a ${ordinal} outreach email.

Business: ${lead.name}
Address them as: ${salutationName}
Tone: ${tone || "Friendly, casual"}
This is touch ${touchNumber} of the sequence (touch 1 was the original email).
Urgency level for this touch: ${urgencyGuidance}${painPointLine}

The ${ordinal} email said (for your context only - don't repeat it, just build on it naturally):
"""
${previousBody}
"""

Rules:
- Keep it SHORT - 2-4 sentences max. This is a bump, not a re-pitch.
- Don't restate the original problem/pitch in detail - reference it in passing at most ("following up on my note about...").
- If a specific problem/pain point was identified above, point back at it directly rather than staying generic - that's what makes this feel like a real follow-up and not a template nudge.
- Sound like a real person nudging a conversation forward, not a template.
- No guilt-tripping, no "just checking in" filler with nothing else said - add one small new angle, question, or reason to reply if possible.
- Do not open with a greeting salutation naming the person if it would feel redundant with a real email thread (a brief natural opening is fine either way).
- End with a clear call-to-action as an actual question or specific ask, not a vague trail-off.${languageInstruction}${linkSection}${linkSeparationRule}${customSection}
${HUMANIZE_INSTRUCTION}
- Never write a sign-off, closing salutation, or the sender's name anywhere in the message - the real signature is always appended separately after this.
- Never use a placeholder in brackets for a name, company, or any other detail - if you don't know something specific, don't reference it at all rather than leaving a placeholder.

Return ONLY the follow-up email body text (no subject line, no signature).`;
}

// Generates a short follow-up email body, threaded against the original
// send (touchNumber counts from 1 = the original email, so touchNumber 2
// is the first follow-up). Reuses the same signature the original email
// used - the recipient already saw it once, no need to regenerate it.
async function generateFollowUpContent(
  userId,
  { lead, tone, language, previousBody, touchNumber, signature, signatureFontFamily, signatureFontSize, aiProvider, analysis, meeting, meetingLink, whatsapp, whatsappLink, customInstructions }
) {
  const prompt = buildFollowUpPrompt({ lead, tone, language, previousBody, touchNumber, analysis, meeting, meetingLink, whatsapp, whatsappLink, customInstructions });
  const result = await generateWithFallback(userId, prompt, { onlyProvider: aiProvider || undefined });
  if (!result.ok) return result;
  const signatureHtml = wrapSignatureWithFont(signature != null && signature !== "" ? signature : DEFAULT_SIGNATURE, signatureFontFamily, signatureFontSize);
  const bodyText = ensureLinksPresent(stripAiPlaceholderSignoff(stripAiDashes(result.text.trim())), [
    { label: "Book a time", url: meeting ? meetingLink : null },
    { label: "WhatsApp", url: whatsapp ? whatsappLink : null },
  ]);
  return { ok: true, content: bodyText, signatureHtml, provider: result.provider };
}

const LENGTHS = ["Detailed", "Medium", "Short", "Concise"];

const PLATFORM_LIST = ["email", "facebook", "instagram", "linkedin", "tiktok", "whatsapp"];

module.exports = {
  TONES,
  LENGTHS,
  LANGUAGES,
  PLATFORM_LIST,
  PLATFORM_GUIDANCE,
  DEFAULT_SIGNATURE,
  buildContentPrompt,
  generateOutreachContent,
  generateSubjectOnly,
  generateFollowUpContent,
};
