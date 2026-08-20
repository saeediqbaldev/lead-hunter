// A practical (not full RFC-5322) email format check - good enough to
// catch the malformed addresses that actually show up in scraped data:
// missing/extra @ symbols, stray whitespace, concatenated addresses with
// no separator, HTML entities that never got decoded, and similar
// scraping artifacts. This is what "501 5.1.3 Bad recipient address
// syntax" from Hostinger's SMTP server is complaining about - it's a
// syntax check on their end, not a deliverability/reputation issue, so
// catching it before we ever hand the address to SMTP avoids the failure
// (and the campaign-wide pause it triggers) entirely.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmailAddress(email) {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed !== email) return false; // leading/trailing whitespace is itself a sign of a scraping artifact
  if (trimmed.length > 254) return false; // RFC 5321 practical max
  return EMAIL_PATTERN.test(trimmed);
}

// Website templates and page builders very commonly ship with a
// placeholder contact address that a developer forgot to replace -
// "John Doe", "your@email.com", "name@domain.com", "example@..." are
// all extremely common leftovers a scraper can easily mistake for a
// real contact. Checked as an EXACT match on the local part (before
// the @), never a substring - "johnsmith@company.com" must never be
// caught by a check for "john", since that's a real name, not a
// placeholder.
const DUMMY_LOCAL_PARTS = new Set([
  "example", "demo", "yourmail", "email", "john", "doe", "your", "you", "name",
  "test", "sample", "placeholder", "yourname", "youremail",
]);
// example.com/.org/.net are IANA/RFC 2606 reserved specifically for
// documentation and examples - never a real business's domain, so any
// address on one of these is fake regardless of its local part.
const DUMMY_DOMAINS = new Set(["example.com", "example.org", "example.net", "yourdomain.com", "domain.com"]);

function isDummyEmail(email) {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const localPart = email.slice(0, at).trim().toLowerCase();
  const domain = email.slice(at + 1).trim().toLowerCase();
  return DUMMY_LOCAL_PARTS.has(localPart) || DUMMY_DOMAINS.has(domain);
}

module.exports = { isValidEmailAddress, isDummyEmail };
