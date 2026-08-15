# Prospect — Lead Hunting Board (V1)

A self-hosted tool that searches Google Places for businesses matching a
niche + location, flags what service each one likely needs (website design,
GMB optimization, local SEO, etc.), and gives you a board to shortlist and
track them. Capped at 100 new leads/day by default to stay inside Google's
free API quota.

## What's in this V15.41
Engaged, Won, and Converted leads are now permanently excluded from all
future outreach - the website inspection accuracy problem is still
ahead.

- **A one-way flag, not a live status check** - set the moment a lead
  first reaches Engaged/Won/Converted and never cleared again, even if
  the status is later changed back (by mistake or otherwise). This is
  the deliberate difference from just checking current status: once a
  lead crosses this line, it stays excluded forever, matching exactly
  what was asked for.
- **Blocks every actual way an email gets sent** - campaign creation
  (including a lead explicitly hand-picked into the campaign, not just
  bulk-scoped ones), automatic follow-up scheduling, and the manual
  "Send Now" action. Traced through the whole app to confirm there's no
  other path that actually dispatches an email outside of these three.
- **Existing leads already at one of these statuses get backfilled
  automatically** - a lead that reached Won before this feature existed
  is still correctly excluded going forward, verified directly against
  a simulated pre-upgrade install.
- **A clearer error message** when a campaign scope has no valid leads
  - now distinguishes "nobody has an email on file" from "these leads
  are permanently excluded," since the old generic message would have
  been actively confusing for a lead that has an email but was excluded
  for having already converted.
- Verified the complete, most important case end-to-end: mark a lead
  Won, confirm a campaign explicitly targeting it silently skips it,
  revert the status back to New, and confirm it's still excluded on a
  second attempt - exactly the "forever, no matter what" behavior asked
  for.

## What's in this V15.40
Finishes the campaign detail work: opens a running campaign scrolled to
where you'd actually want to look, keeps the action buttons reachable
while scrolling, and campaigns can now recover from a transient SMTP or
AI provider failure on their own.

- **Opening a running campaign now scrolls straight to the most
  recently sent lead** - usually the thing you actually want to check
  on, not the top of a long, mostly-pending list. Verified in a real
  browser: the view lands exactly on the boundary between sent and
  pending leads.
- **The header (title, Start/Pause/Resume/Cancel/Delete) stays visible
  while scrolling** through a long lead list, and the Back button moved
  to the far left, next to the title, instead of being just the
  left-most button in the right-aligned action group.
- **A campaign paused by an actual failure (SMTP rejecting a send, the
  AI provider erroring out) now tries to resume itself after 5
  minutes** - many of these are transient and don't need someone to
  notice and click Resume by hand. Deliberately never touches a
  campaign you paused yourself - traced the exact distinction the app
  already makes between the two. Capped at 5 automatic attempts so a
  genuinely broken config (wrong password, etc.) doesn't retry forever
  and spam notifications; the counter resets the moment a send actually
  succeeds, or if you resume it yourself. Verified against all four
  real cases: an eligible campaign resumes correctly, a manually-paused
  one is never touched, one still under 5 minutes correctly waits, and
  one that's already used up its retries correctly stays paused.

## What's in this V15.39
Fixed the Go-to-Top button (a real bug, not a missing feature), and
reworked follow-up timing to be drift-free with automatic bounce
handling. Item 3 (campaign detail scroll/sticky buttons/auto-resume)
is still in progress.

- **The Go-to-Top button was never actually going to appear** - a
  leftover inline `display:none` in the HTML was silently overriding
  the CSS that was supposed to fade it in on scroll, so no amount of
  scrolling would ever have shown it. Fixed and verified directly: it
  now appears after scrolling and correctly scrolls back to top on
  click.
- **Follow-up timing is now anchored to the first email sent to each
  lead**, not the most recent touch - so if one touch in the sequence
  goes out later than scheduled, the rest of the sequence doesn't drift
  forward with it. Verified with a deliberately-late touch: under the
  old logic the next follow-up would have shown as not-yet-due; under
  the new logic it correctly shows as overdue, anchored to the original
  first send. Applied to both the actual scheduler and the "upcoming
  follow-ups" list shown in the UI, so what you see always matches what
  will actually happen.
- **A bounced email now automatically stops further follow-ups for
  that lead** - not just silently excluded from the next scheduling
  pass (which was already happening), but an explicit, visible stop
  using the exact same mechanism the manual "Stop follow-ups" button
  already used. Verified against three scenarios: a bounce on the most
  recent touch (correctly auto-stopped), a bounce on an older touch
  that's since been superseded by a later send (correctly left alone,
  since it's no longer relevant), and a bounced email with no campaign
  association at all (correctly ignored, no crash).

## What's in this V15.38
The last two pieces of the fit-score plan - a campaign-creation warning
for low-graded leads, and a one-time backfill for leads scraped before
the feature existed. The fit-score system from the original pitch is
now fully built end-to-end.

- **A soft warning when creating a campaign** with D/F-graded leads in
  it - shows exactly how many of the selected leads are low-graded and
  lets you send anyway or go back and narrow the selection, rather than
  silently spending sends, follow-ups, and AI generation on leads that
  were unlikely to convert. Deliberately a warning, not a block - you
  know your market better than a score does. Verified the complete
  path end-to-end in a real browser: the warning shows the right
  counts, confirming actually creates the campaign, and a campaign
  with only good-graded leads skips the warning entirely.
- **A one-time "Score existing leads" button** in Account Settings -
  scores every lead that predates this feature using the instant,
  free base score (no AI, no cost), while leaving anything already
  graded completely untouched. Verified against 1,000 leads at once:
  scored correctly in about 200ms, a lead that already had an
  AI-refined grade was left exactly as it was, and running it again
  correctly reports nothing left to do.

## What's in this V15.37
A genuinely more polished email closing, and hints for the fit-grade
and email-provider systems in the info modal. The campaign-creation
warning and bulk backfill from the fit-score plan are still ahead.

- **The signature's closing line is warmer and more substantive** -
  "Thank you for taking the time to read this - we'd love the
  opportunity to help your business grow online," not just a generic
  line. Also fixed a real polish issue while in there: "Ceo" was
  missing its proper capitalization. Applied carefully, same as last
  time - a brand new account gets it immediately, an account still on
  either previous version gets upgraded automatically, and a genuinely
  customized signature is left completely untouched. Verified all
  three cases directly again.
- **The call-to-action instruction now has real teeth** - not just
  "include a CTA," but concrete examples of what confident, credible
  closing lines actually sound like versus the uncertain, forgettable
  ones AI often defaults to ("let me know your thoughts," "hope to
  hear from you"). Applied to both the main content generator and
  follow-ups, since the follow-up version was noticeably weaker before.
- **Hints for the fit-grade and email-provider systems**, added to the
  existing info modal (the "i" icon next to the board) - what each
  grade means, why a missing website often scores *higher* not lower,
  and how the three email providers (Hostinger/Gmail/Bluehost-Titan)
  relate to each other. Caught and fixed a real layout bug of my own
  while building this - a line mixing several bold terms was breaking
  onto its own narrow column due to a flex-layout quirk shared with
  every other item in that modal; verified the fix renders correctly
  before shipping it.

## What's in this V15.36
Filter and sort the board by fit grade - the campaign-creation warning
for low-graded leads and a bulk backfill for existing leads are still
ahead.

- A new "Grade" filter next to Need in the board's filter panel - A
  through F, or "All grades." Wired into every place the board's active
  filters get used (the main board query, "scrape current view," and
  export), so filtering to just A/B leads genuinely scopes every one of
  those actions the same way, not just what's on screen.
- A new "Best fit first" sort option, right alongside the existing
  ones.
- Verified end-to-end in a real browser: filtering to Grade A correctly
  narrowed 3 leads down to exactly the 1 that qualified, and sorting by
  best fit first correctly ordered all 3 from highest to lowest score.

## What's in this V15.35
Fixed a real bug affecting live sent emails: the AI would sometimes
ignore instructions and add its own broken sign-off like "Best, [Your
Name]" - since it has no way of knowing the actual sender's name.

- **The instructions themselves are now explicit and impossible to
  half-follow**: never write any sign-off or name at all (not "keep it
  short," the full sign-off is banned outright), and never use a
  bracket placeholder for anything - if a detail isn't known, leave it
  out entirely rather than placeholder it. Found this exact weak
  wording in the follow-up prompt too, which had an even softer
  version of the same instruction than the main one - now both say the
  same clear thing. Also reworded an instruction that was showing the
  AI a "don't do this" example using a literal bracket, since even a
  negative example can reinforce a pattern.
- **A deterministic safety net catches whatever still slips through**
  - the same kind of backstop already in place for em dashes and
  broken links. Verified this against the exact bug reported: a
  simulated AI response ending in "Best regards,\n[Your Name]" came out
  completely clean, with the real call-to-action question preserved
  intact. Also specifically verified this doesn't create a new problem
  of its own - legitimate bracketed text unrelated to a placeholder
  (like citing "[A/B testing]" as a real term) is left completely
  untouched, only actual name/company-style placeholder patterns get
  removed.
- Together with the signature's own "Thank you for your time and
  consideration... Kind Regards, Xeven Pixels" closing from an earlier
  version, an email's ending is now consistently: a real, specific
  call-to-action question, then a genuine thank-you signed off as Xeven
  Pixels - never a broken placeholder reaching a real recipient.

## What's in this V15.34
The agency profile is now visible and editable, and the "why" behind a
grade is finally shown, not just the letter. Filter/sort by grade,
campaign-creation warnings, and a bulk backfill for existing leads are
still ahead.

- **A real settings page for your agency profile** - the description
  grounding every fit-score judgment was already saved and working from
  what you told me directly, but there was no way to see or change it
  until now. It's in Account Settings, pre-filled correctly. Verified
  it loads, saves, and survives a fresh page reload.
- **The fit score's actual reasoning is now visible**, not just a
  letter badge - opening a lead's inspection panel shows the grade,
  the score, and the one-line reason right alongside the existing
  strengths/weaknesses. When the AI flags a likely mismatch (the
  scraped site probably doesn't belong to this business), a clear
  warning banner shows why, instead of that information sitting
  unused in the database. Verified end-to-end in a real browser,
  including the mismatch warning rendering correctly.

## What's in this V15.33
The fit-score system - backend foundation and the grade badge on the
board. Settings page, campaign-creation warning, and bulk backfill for
existing leads are still ahead.

- **An instant, deterministic fit score** on every newly scraped lead -
  computed the moment it's imported, no AI needed. Weighs how
  established the business looks (review count *relative to others in
  the same niche*, not a fixed threshold), rating quality on a
  deliberately non-linear curve (a 3.3-4.9 range scores best - proven
  enough to have real reviews, not so flawless there's nothing to
  pitch), how big the opportunity is (no website at all scores highest,
  since that's the cleanest full-build opportunity), and whether the
  lead is actually reachable. A closed business is hard-gated to an F
  regardless of everything else. Verified against five deliberately
  different scenarios and every one matched the intended design.
- **An AI-refined score that rides on the analysis pipeline you already
  had** (the one that writes strengths/weaknesses for personalization) -
  no separate AI call, no added cost. Critically, this score is
  explicitly instructed to often be the *inverse* of "how good is their
  current site" - a business with a poor or missing website is a better
  prospect, not a worse one, and the prompt now includes your actual
  agency profile so the suggested services are ones you actually offer,
  not generic marketing advice. It also flags when the scraped website
  doesn't actually look like it belongs to the business (wrong company,
  franchise HQ page, aggregator listing) - a real failure mode with
  Google Places data that a fixed formula can't catch. Verified the
  full loop end-to-end: a lead starts at its instant score and
  correctly upgrades once analysis completes.
- **The score updates as you learn more**, not just once - finding an
  email via the Scrape button now bumps the contactability part of the
  score, and a lead already upgraded to an AI-refined score is never
  regressed back down by a later re-scrape or re-import. Verified both
  directions directly.
- **A colored grade badge right next to the lead's name** on the board
  - green through red, with the exact score and whether it's the
  instant or AI-refined version on hover. Verified in a real browser:
  correct grades on the leads that have one, and no badge at all
  (rather than something broken) for a lead that doesn't yet.
- Also fixed a real typo of my own along the way - a stray escaped-quote
  artifact in the analysis prompt that would have corrupted the
  checklist formatting sent to the AI.

## What's in this V15.32
Campaigns reverted from the deep tree back to the familiar grid style -
Niche > Country > City > cards, click a card for the full detail view
with its tab bar back.

- The Email List/Sent/Replied/Report/Follow-ups tab bar is back inside
  each campaign, rather than the tree itself being the navigation.
- Follow-ups didn't lose any capability in the revert - the tab now
  shows a small grid of "Followup 1," "Followup 2," etc. cards, each
  with View/Edit/Pause/Resume, plus the existing "due now" list of
  individual leads below it. Clicking View drills into that one
  follow-up's own scoped Email List/Sent/Replied/Report with a clear
  way back to the main tab bar.
- Verified the complete path end-to-end in a real browser: the grid
  renders, clicking a card opens the tab bar, the Follow-ups tab shows
  both configured levels as cards, drilling into one and clicking back
  correctly returns to the main campaign view.

## What's in this V15.31
A proper, thankful email ending, and full font customization for the
signature.

- **A professional, thankful closing line** now opens the default
  signature ("Thank you for your time and consideration.") before the
  sign-off - traced the architecture first and confirmed this is where
  an email's actual "ending" lives, since the AI-generated body
  deliberately never includes its own sign-off. Applied carefully: a
  brand new account gets the new default, an account that never
  customized its signature away from the original gets upgraded
  automatically, and a genuinely customized signature is left completely
  untouched - verified all three cases directly. Also found and fixed a
  real bug along the way: the "Reset to default" button had its own
  separate, stale copy of the old text that would have quietly undone
  this every time someone clicked it.
- **Font family and size controls for the signature** - up to 10 fonts
  (Poppins, Work Sans, Open Sans, Roboto, Lato, Montserrat, Inter,
  Nunito, Raleway, and Verdana) and a 6-36px size slider, with a live
  preview while editing. Traced this through every place a signature
  actually gets used - the main content generator, follow-ups, and the
  campaign scheduler - since missing any one of them would mean some
  emails quietly ignored the chosen font. Verified the complete pipeline
  end-to-end: picking a font and size in a real browser, saving,
  reloading the page fresh and confirming it comes back correctly, and
  separately confirmed through the actual generation code that the
  right font/size lands in the final signature HTML for both a new
  email and a follow-up.
- Worth knowing: most email clients (Gmail, Outlook, etc.) strip
  external fonts from received mail for security reasons, so a
  recipient may see their own client's default font rather than the
  exact one chosen - this is a universal constraint of HTML email, not
  specific to this app, and the editor now says so directly rather than
  overpromising.

## What's in this V15.30
The Campaigns tree stuck-loading bug from your screenshot, a website
icon everywhere in Campaigns, and clean domain-only website URLs going
forward.

- **Found and fixed the actual bug behind the stuck "Loading…" tree.**
  Expanding a campaign was fetching its *entire* lead list (with a
  3-way join and per-row parsing) just to display 4 summary numbers,
  and any failure along the way left the tree stuck permanently with no
  recovery - the exact behavior in your screenshot. Fixed with a real,
  lightweight summary endpoint (verified 87% smaller payload, no joins
  at all) plus a proper error state with a working retry button, so a
  failure now always shows something actionable instead of hanging
  forever. Verified end-to-end with a simulated real failure and
  confirmed retry correctly recovers.
- **A clickable website icon in every campaign lead list** - opens the
  lead's website in a new tab. Shown dimmed when a lead has no website
  on file. Caught and fixed a mistake of my own while verifying this:
  I'd used an icon class name that doesn't exist in this app's icon set
  and wouldn't have rendered at all - fixed to match the same class the
  app already uses successfully elsewhere.
- **Scraped websites are now always the clean main domain** - stripped
  of any subpage path and query string (including utm_* tracking
  params) at the one place every Google Places result gets processed
  before being stored, so this applies automatically regardless of
  which specific page or campaign link Google happened to have on file.
  Verified against a realistic messy URL (subpage + multiple UTM
  params) through the actual scraping flow, and confirmed the existing
  duplicate-branch detection logic - which does its own domain matching
  - is completely unaffected.

## What's in this V15.29
Bluehost/Titan is now a real, complete section - same feature set as
Hostinger - and Gmail campaigns actually work end-to-end, finishing off
the multi-provider work from last version's backend foundation.

- **Bluehost/Titan** gets its own sidebar section with all 6 views
  (Tracking, History, Alerts, Reports, Campaigns, Setup) and its own
  dedicated settings storage - deliberately separate from Hostinger's,
  since sharing storage would mean setting up Bluehost/Titan could
  silently overwrite real Hostinger credentials for anyone with both
  configured. Verified this directly: saved Bluehost/Titan settings in
  a real browser and confirmed Hostinger's own settings came back
  completely untouched afterward.
- **Gmail's missing "Campaigns" link is added** - it had Tracking,
  History, Alerts, Reports, and Setup already, but no way to reach
  Campaigns at all until now.
- **Campaigns are now scoped to whichever provider section you're in**
  - a campaign sent via Hostinger shows up under Hostinger's Campaigns
  and nowhere else, and creating a new campaign from within a specific
  provider's section automatically sends it through that provider.
  Verified directly: a Hostinger campaign correctly stayed invisible
  under Gmail's Campaigns view.
- Found and fixed a real mislabeling bug while building this - a couple
  of places checked "is this Gmail? then Gmail, otherwise Hostinger,"
  which would have shown "Hostinger" for Bluehost/Titan too. Replaced
  with a single shared lookup so adding a future provider can't
  silently reintroduce the same mistake.

## What's in this V15.28
Backend foundation for Gmail and Bluehost/Titan campaign sending - the
frontend (provider picker, Bluehost/Titan's own sidebar section) is
still ahead, covered in the next version.

- **Found that Gmail credentials already existed in the database but
  were completely unused everywhere** - the Setup page let you save an
  App Password, but nothing in campaign sending or reply checking ever
  read it. Every part of sending is now built around a real provider
  registry (Hostinger, Gmail, Bluehost/Titan) instead of being
  hardcoded to Hostinger throughout, and along the way found and fixed
  two actual bugs from that hardcoding: a sent email's provider was
  always recorded as "hostinger" in the tracking table regardless of
  which account actually sent it, and the SMTP lookup itself ignored
  which provider a campaign was configured to use.
- **Gmail uses its well-known, stable hosts** (smtp.gmail.com,
  imap.gmail.com) with just your address and App Password needed.
  **Bluehost/Titan gets fully configurable SMTP+IMAP**, same as
  Hostinger already has, since assuming a specific hostname for it
  risked being wrong for a real account.
- **Reply/bounce checking now runs per-provider independently** - each
  one gets its own IMAP connection and its own "last checked" timestamp,
  so checking Hostinger can never cause Gmail (or vice versa) to
  incorrectly skip past replies it's never actually looked at. A user
  with only one provider configured is unaffected; the others are
  simply skipped rather than attempted.
- Verified extensively with mocked SMTP/IMAP: a full Gmail send
  end-to-end (correct host, correct Sent-folder detection for Gmail's
  own "[Gmail]/Sent Mail" naming, correct provider recorded), the
  reply-checker correctly checking only configured providers and
  leaving others untouched, and - importantly - a full regression
  confirming an existing Hostinger campaign created with no explicit
  provider still behaves exactly as it always has.
- Also caught and fixed a real migration robustness gap while testing
  this: two related database columns were being added together gated
  on a single existence check, which could leave the schema
  inconsistent if they ever got out of sync. Fixed to check each
  independently.

## What's in this V15.27
Database indexes and a Go to Top button - the first part of a larger
performance/feature request, with the Gmail and Bluehost/Titan work
still ahead.

- **9 missing database indexes added** on columns queried constantly
  throughout the app but never indexed: leads by catch log, status, and
  pinned state; catch logs by niche and country; and - likely the
  biggest single win - email_campaign_leads by (campaign, lead), which
  the "latest touch per lead" lookup used throughout campaigns and
  follow-ups runs once per candidate row every time it's called.
  Indexes only ever speed up queries, they never change what a query
  returns, so this genuinely can't break any existing feature or
  behavior. Verified a full fresh-schema creation succeeds cleanly with
  all 22 indexes (13 original + 9 new) actually present, and separately
  verified a second load against an already-existing database is
  equally clean.
- **A "Go to Top" button**, fixed at the bottom right, appearing once
  any panel is scrolled down and smoothly scrolling back to the top on
  click. Built to specifically avoid adding overhead to the frequent
  scroll event itself (using the element that actually scrolled
  directly, rather than searching the DOM on every scroll tick) given
  the whole point of this round is speed, not adding to the problem.
  Verified end-to-end: hidden by default, appears after scrolling the
  actual content area (which for Board specifically isn't the outer
  panel but a nested scroll container, found and handled correctly),
  and correctly returns to the top on click.

## What's in this V15.26
Campaigns rebuilt as a real tree, matching Reach Out's own structure and
the confirmed shape: Niche > Country > Campaign Name > Email List / Sent
/ Replied / Report / Followups, with Followups expanding into
independently-editable Followup 1, Followup 2...

- The old flat "niche heading + grid of cards, click into a tab bar"
  layout is gone - a campaign is now a genuine expandable tree node.
  Expanding it reveals the 5 sub-items as clickable rows with live
  counts, the same visual language as Reach Out's own pipeline stages.
  Clicking any of them navigates straight to that specific, filtered
  view - the old tab bar is fully retired in favor of the tree.
- Expanding "Followups" reveals every follow-up level up to the
  campaign's max count as its own row (even one no lead has reached
  yet, since the point is being able to configure it ahead of time),
  each with its own 4 sub-items and its own 3-dot menu: Edit opens that
  one follow-up's independent settings panel (built on last version's
  backend work), Pause/Resume stops or resumes just that level.
- **Found and fixed a real bug while building this** - the exact same
  class of CSS issue caught once before in an earlier version (an
  ancestor's "expanded" state cascading through a *closed* level nested
  inside it, since the underlying selector matches at any depth, not
  just direct children). This time it meant expanding one specific
  Followup was incorrectly revealing every other Followup's content too.
  Fixed the same way as before - a dedicated, isolated class instead of
  reusing a broader one - and verified directly: expanding only Followup
  1 now shows only Followup 1's own 4 rows, with Followup 2 correctly
  staying collapsed.
- Verified the complete path end-to-end in a real browser: expanding
  the tree down to a specific follow-up, editing its tone and adding
  custom instructions, saving, and confirming those exact values came
  back from the server afterward.

## What's in this V15.25
Backend foundation for treating each follow-up as its own independently
configurable sub-campaign - the tree/UI restructuring itself is still
ahead, covered in the next version.

- **Each follow-up level (Followup 1, Followup 2...) can now have fully
  independent settings** - tone, length, language, links, custom
  instructions - distinct from the main campaign and from each other.
  A follow-up with no override still behaves exactly as it always has,
  falling back to the main campaign's own settings, so nothing about
  existing campaigns changes unless a follow-up is explicitly
  customized. Verified the fallback and override behavior directly, and
  confirmed a different, never-touched follow-up level stays completely
  unaffected by customizing a different one.
- **Each follow-up level can be paused or resumed independently**,
  stopping every lead from advancing to that specific touch without
  affecting any other touch. Verified this blocks even the manual
  "Send Now" override, not just the automatic schedule - a paused level
  now genuinely means nothing sends at that level, regardless of how
  it's triggered.
- **Found and fixed a real gap while building this**: undeliverable
  addresses from the original send were never being excluded from
  follow-ups at all - the scheduler had no check for a bounced original
  email. Fixed and verified directly: a lead whose original send bounced
  correctly stays excluded from every future touch, while a different,
  genuinely-delivered lead in the same campaign correctly proceeds.

## What's in this V15.24
Pin cleanup, a proper 2-minute tracking grace window, and confirmation
that campaign content already saves to the lead itself.

- **One-time pin cleanup**: every currently-pinned lead gets unpinned,
  except ones with real pipeline progress (Engaged/Won/Converted) - this
  clears the backlog left over from the now-removed "email opened"
  auto-pin logic. Runs exactly once (gated by a flag), so manually
  pinning a lead afterward - of any status - is completely unaffected
  and survives future restarts. Verified directly: a lead manually
  re-pinned right after the cleanup stayed pinned through a second
  simulated restart.
- **Extended the open/click grace window from 8 seconds to 2 minutes**,
  and applied the same rule to clicks for the first time (previously
  only opens had any grace period at all). An open or click in the
  first 2 minutes after sending is far more likely to be a mail client's
  own image-preload, a security scanner, or the sender's own review than
  a real recipient action - anything past 2 minutes counts normally.
  Verified the exact boundary: a click sent immediately was correctly
  suppressed while still redirecting the person to the real link, and
  the same click sent again 3 minutes later was correctly counted -
  confirming a suppressed click never leaves anyone stuck instead of
  reaching what they clicked.
- **Investigated and confirmed** that campaign-generated content
  already saves to the lead's own record and loads automatically when
  the lead is expanded - this was built in earlier work I hadn't
  re-verified until now. Confirmed directly in a real browser: content
  generated and sent by a campaign shows up in the lead's own "Generate
  Content" panel without needing to regenerate anything.

## What's in this V15.23
A 3-dot menu on every country in Hunt - Rename, Delete, and Scrape All.

- **Rename** - updates every city under that country in this niche
  together. Caught and fixed a real route-ordering bug while building
  this: an existing wildcard route would have silently swallowed the
  new endpoint entirely if left in the wrong order - verified the fix
  directly, and separately verified renaming only touches the intended
  niche's cities, nothing else.
- **Delete** - permanently removes every city under that country and
  every lead inside them, exactly the scope confirmed before building
  it. A strong, explicit confirmation dialog states this plainly before
  anything happens. Verified deleting one country leaves a different
  country's cities and leads completely untouched.
- **Scrape All** - runs the contact scraper across every city in a
  country, one at a time (the scraper only supports one active job at
  once, so this queues them). Built as a small background job system of
  its own, similar to how campaign sending already works, so the scrape
  keeps running even if the browser tab is closed and correctly resumes
  showing progress after a page refresh. Progress shows directly in the
  country's own row in Hunt ("2/5: Augsburg"), which was the specific
  ask.
- Verified end-to-end through the real UI, not just the API: clicking
  Scrape All, waiting on the actual background timer (not simulated),
  and confirming every city's results landed on the right leads while
  a different country stayed untouched throughout. Also caught and
  fixed a real bug in the resume-after-refresh logic during testing - a
  CSS-escaping mismatch meant the progress indicator was silently never
  finding its target element, even though the underlying job and API
  were both working correctly the whole time.
- One more thing worth being upfront about: while iterating on the
  mocked tests used to verify this without a real scraper service to
  test against, an in-progress backup step briefly meant a later
  "restore the real file" command would have restored a test mock
  instead. Caught before packaging by checking the restored file's
  actual size and contents, not just trusting the copy succeeded - the
  file shipped in this build has been directly confirmed clean.

## What's in this V15.22
A new "Follow-ups" tab inside each campaign - full control over every
upcoming follow-up without waiting for it to just happen on its own.

- Shows every lead with a future follow-up still ahead of it: which
  touch is next, and either its scheduled date/time or "Due now" if
  it's overdue.
- **Send now** - jumps the wait entirely for one specific lead. Still
  runs the same reply check the normal scheduled send uses first, so
  this can't accidentally send a follow-up on top of a reply that
  arrived but hasn't been detected yet - skipping that check just
  because it's a manual action would be a real risk, not just a
  formality.
- **Stop** - permanently stops future follow-ups for that one lead,
  without touching any of its earlier, already-sent touches. Built to
  reuse the scheduler's own existing logic rather than needing new
  scheduler code: verified directly that the scheduler's own candidate
  query independently agrees the lead is no longer eligible after
  stopping it.
- The list itself reuses the exact same "which leads are due for a
  follow-up" query the scheduler runs internally, so what's shown here
  can never drift out of sync with what will actually happen.
- Verified end-to-end in a real browser: the tab appears only when
  follow-ups are enabled, an overdue follow-up correctly shows "Due
  now," and clicking Send Now correctly queues it and removes the row
  once it's no longer upcoming.

## What's in this V15.21
Auto-pin on real pipeline progress, delivery-failure tracking, and more
human-sounding AI content.

- **Auto-pin logic replaced**: opening an email no longer pins a lead
  (an open only means a mail client rendered an image, not that
  anything actually happened) - instead, a lead is auto-pinned the
  moment its status moves to Engaged, Won, or Converted, which is real
  progress worth surfacing. An explicit unpin in the same request still
  wins over the auto-pin. Existing pins from the old logic are left
  alone (only the trigger going forward changed, not historical data).
- **Bounced emails no longer count as "Sent"**: extended the existing
  bounce-detection scan to also parse each bounce's body for the actual
  address that failed, match it back to the original send, and mark it.
  Every "Sent" count in the app now excludes these (Reports, the
  extension popup, campaign Report tabs), and the Tracking table shows
  a distinct "delivery failed" badge so it's clear why a row's count
  doesn't match what's visible. Verified end-to-end with a realistic
  bounce body and confirmed the match against a real tracked send, plus
  fixed a bug of my own along the way (a leftover reference from an
  in-progress refactor that would have broken bounce cleanup entirely
  had it shipped).
- **AI-generated content is more human now**: every content prompt
  (pitch, subject, follow-up) now explicitly avoids em dashes, AI
  cliches ("unlock", "elevate", "game-changer", etc), and long
  run-on sentences. Backed by a deterministic safety net that strips
  any em dash or en dash that slips through anyway, tested against a
  mocked AI response that deliberately used one in both the body and
  the subject line, confirming both came out clean.

## What's in this V15.20
Threaded conversation view, dual meeting/WhatsApp links, smarter
follow-ups, and city tracking for campaigns.

- **Threaded conversation view** - opening any tracked email now shows
  the full sequence for that lead (1st email, every follow-up, reply
  status, and the next follow-up's scheduled date/time), not just that
  one message in isolation. Used by both the Alerts dialog and the
  campaign dashboard's expand row, so a follow-up is always shown
  clearly grouped under its original campaign rather than looking like
  a separate, disconnected send. Verified end-to-end with a real 2-touch
  replied sequence, including the reply badge landing on the correct
  touch.
- **A second link (WhatsApp) alongside the meeting link**, usable
  wherever the first one was: campaign creation/editing and the lead-
  level Generate Content panel. Both links persist until manually
  changed - verified directly (editing just the WhatsApp link on a
  campaign leaves the meeting link untouched).
- **Built a real safety net against the two links colliding into a
  broken URL** - found and fixed two bugs in my own first attempts while
  testing it: a naive "is the link present" check that missed a merged
  URL entirely (the first link's characters are technically still
  "there," just glued to the second one), and a boundary check that
  falsely flagged completely normal trailing punctuation. The final
  version was tested against 6 scenarios including the exact merge
  failure, a dropped link, and ordinary punctuation that shouldn't
  trigger anything.
- **Follow-ups now escalate urgency by touch number and reference the
  business's specific pain points** (previously flat and generic
  regardless of how many times the lead had been nudged), carry through
  both links (previously carried neither), and support a per-campaign
  custom-instructions field for genuine control over what every
  follow-up in that campaign emphasizes.
- **City tracking**: a campaign now reports how many distinct cities it
  covers, and a city already used in a non-draft campaign for a niche is
  excluded (grayed out, labeled) from being picked again when creating a
  new one - verified a draft doesn't trigger this but a running campaign
  does, and that unrelated cities stay selectable.

## What's in this V15.19
Body-content reply detection, redirect-email suggestions, and a real
search bar for History and Alerts.

- **Search bar added to History and Alerts, and expanded on History** -
  now searches subject, recipient email, and body text ("a sentence"),
  not just subject. Alerts had no search at all before. Verified finding
  results by email address specifically on both.
- **Found and fixed a real gap in reply detection**: support-ticket-style
  acknowledgments ("we've received your email, our team will review it,
  no reply is needed") were being counted as genuine replies, since the
  existing detection only checked the subject line and headers - many
  systems send this kind of reply with a normal-looking subject and none
  of the headers checked. Fixed by adding a second pass that downloads
  and parses the actual body text (new dependency: mailparser) for
  messages that pass the cheaper checks, checking for common
  acknowledgment phrasing before finalizing anything as a genuine reply.
  Verified against the exact real-world example provided - correctly
  excluded.
- **Redirect-email suggestions**: when a reply's body hints at
  redirecting to a different contact ("wrong department, please email
  sales@company.com instead"), an AI call confirms it and extracts the
  address. Never auto-resends anywhere - the suggestion is stored on the
  lead and surfaced as a banner in its expand panel, with "Use this
  email instead" or "Dismiss." Verified end-to-end: detection, storage,
  the banner appearing, applying it and the lead's actual contact email
  updating correctly, and the suggestion clearing afterward.
- **On the contact scraper "decision-maker" request**: this needs to be
  addressed honestly rather than guessed at - the scraper only returns
  one email per business today, and the logic that picks it lives in the
  separate Python scraper service, whose source isn't in this
  repository. That can't be changed from here; it would need work on the
  scraper service itself.

## What's in this V15.18
Campaigns restructured to match the requested Niche > Country > City
tree, and renamed from "Auto Send."

- **"Auto Send" renamed to "Campaigns"** throughout - sidebar label and
  page header.
- **The campaigns list is now a genuine expandable tree** - Niche >
  Country > City, matching the same drill-down interaction as Hunt/
  Reach Out/Pinned, with the existing rich campaign cards (status,
  progress, location) appearing as leaves once a city is expanded.
  Niches default open (there are usually only a handful); country and
  city default closed, the same balance Hunt's own tree strikes.
- **A real bug found and fixed during this build**: the City level
  initially reused the same CSS class as the Country level, which meant
  an existing, broader visibility rule (built for the simpler two-level
  Hunt/Reach Out/Pinned trees) incorrectly cascaded through a *closed*
  City whenever its Country ancestor was open, since descendant
  selectors match at any depth, not just direct children - campaign
  cards were appearing one click too early. Fixed by giving the City
  level its own dedicated, fully isolated class rather than fighting a
  specificity war with a rule used elsewhere. Verified precisely at each
  step: hidden with everything collapsed, still hidden with only the
  country expanded, correctly visible (and correctly isolated to that
  one city) only once the city itself is also expanded - and separately
  confirmed the original Hunt tree is unaffected by this change.

## What's in this V15.17
Automatic bounce-message cleanup (destructive, by explicit request) and
select-all-in-country for campaign creation.

- **"Undelivered Mail Returned to Sender" and similar bounce notices are
  now automatically moved to Trash** during the existing periodic inbox
  check - not permanently expunged, so there's still a recovery path if
  a specific message was ever misjudged, the same way "delete" works in
  any normal mail client. Detection is deliberately stricter than the
  existing auto-reply filter, since this one leads to removal, not just
  "don't count as a reply": the RFC 3464 delivery-status marker is
  trusted alone (real mail essentially never carries it), but the
  subject/sender-pattern signals are only trusted together, never
  individually, to keep false positives close to zero. Tested against 7
  cases including both real examples from your screenshot (both
  correctly caught) and four plausible false-positive risks - a genuine
  email merely mentioning "undeliverable," a bounce-shaped subject from
  a real person, a systemic-looking sender with an unrelated subject,
  and an ordinary reply (all four correctly left alone). A notification
  summarizes what was cleaned up each time, and a defensive cap limits
  how many get processed in a single cycle.
- **Select-all-in-country** added to the campaign creation city picker -
  one checkbox per country checks (or unchecks) every city under it.
  Verified correct isolation between countries (selecting all of Germany
  doesn't touch Austria) and that unchecking correctly clears the whole
  group.

## What's in this V15.16
Fixed the Contact Scrape "Unexpected token '<'" error, diagnosed directly
from real Coolify logs.

- **Found the actual root cause**: the app tracks whether a scrape is
  running with an in-memory lock, which resets to empty every time the
  app restarts or redeploys - but the separate scraper service is a
  longer-lived process whose own "is a job running" state doesn't reset
  along with it. If the app restarted while the scraper was genuinely
  still mid-job, the app would forget that entirely and go straight to
  resetting on the next scrape attempt, which the scraper (correctly
  remembering its own job) would keep rejecting with a 409 - forever,
  since nothing ever told it to stop. The logs showed exactly this: the
  same 409 repeating over and over with no recovery.
- **Fixed**: the scraper's own live status is now always checked first,
  regardless of whether the app's lock survived a restart. A job still
  running with no matching lock on the app's side is by definition
  orphaned - safe to stop automatically and proceed, rather than getting
  stuck in the same failure loop indefinitely. Verified this exact
  scenario directly (empty lock, scraper still reporting a running job)
  and confirmed a scrape now starts successfully instead of looping.
  Separately verified a genuinely active job from the same user is
  still correctly blocked with a clear message, rather than accidentally
  interrupting real in-progress work.
- **Hardened the frontend too**, as a safety net for any other cause of
  a non-JSON response (a brief restart window, a reverse-proxy timeout):
  the raw "Unexpected token '<'..." parse error is replaced with a clear,
  actionable message across all three scrape-related calls (start,
  status polling, and resuming polling on reopen).

## What's in this V15.15
A full dashboard inside each campaign - four tabs instead of one flat
list.

- **Emails List** - every lead in the campaign, any status, with
  checkboxes and a "Delete selected" bulk action to remove leads from
  the campaign's roster (doesn't touch already-sent emails' history in
  Tracking/History - only removes them from this campaign's own view).
  Guards against deleting a lead the scheduler is actively mid-processing
  right now, to avoid a race.
- **Sent** - filtered to successfully sent emails, read-only.
- **Replied** - filtered to leads with a genuine reply detected, read-only.
- **Report** - campaign-scoped stats (sent, opened, clicked, replied,
  failed, skipped, with rates), computed from the same data already
  loaded rather than a separate round trip.
- All three list tabs share the same rich per-lead expand panel from
  before (subject, engagement, retry/skip for failed leads, full
  Inspection/Content/Website detail) - nothing from the existing detail
  view was lost in restructuring it into tabs.
- **Caught and fixed a real bug while building this**: live campaign
  status polling located cells by column position, which the new
  checkbox column would have silently broken (a second time - this
  exact class of bug happened once before with an earlier column
  addition). Fixed properly this time with explicit data attributes
  instead of position, so future column changes can't cause the same
  problem again. Verified directly that polling updates the correct
  cells without disturbing others.
- Verified end-to-end with a realistic mixed dataset (sent, replied,
  failed, skipped, pending all present at once): correct counts on every
  tab, correct filtering, bulk delete correctly removing a lead and the
  Report tab's numbers correctly reflecting it afterward. Also verified
  the tab bar stays correctly hidden during campaign creation and
  editing, which reuse the same view.

## What's in this V15.14
Mobile header cleanup and per-campaign notification muting.

- **Mobile header rebuilt to fit on one row** - theme switch and logout
  moved into a 3-dot overflow menu, with the logo, daily lead cap ring,
  and campaign sending indicator all shrunk down. Verified at iPhone SE
  width with zero horizontal overflow (previously it wrapped to a second
  row), the overflow menu opening and its theme toggle actually working,
  and confirmed desktop is completely unaffected - the original buttons
  stay fully functional there, just visually hidden on mobile.
- **Per-campaign alert muting** - mute "opened" and/or "clicked" alerts
  independently for any campaign, updatable anytime from its settings
  (not just at creation). The open/click itself is always fully
  recorded either way - muting only suppresses the alert, never the
  underlying tracking data or your Reports numbers. Verified end-to-end
  through the actual production pixel/click routes (not just direct
  database writes): a muted open correctly updated status and open_count
  but created zero notifications, while an unmuted click on the same
  campaign correctly created one - confirming the two settings work
  independently of each other, not as a single combined toggle.

## What's in this V15.13
The Contacted Reports chart width bug, a donut view toggle, the "stuck
Running" campaign bug, a niche-grouped campaign grid, and pagination for
Tracking and History.

- **Fixed the "Opens & clicks over time" chart not filling its width** -
  every other chart in the app correctly sets Chart.js's
  maintainAspectRatio to false; this one specifically was missing it,
  so it fell back to a default fixed aspect ratio instead of filling
  the card. Verified with real screenshots.
- **Added a donut view toggle** for that same chart - caught and fixed a
  real math error in my own first draft along the way (clicks can
  exceed opens in this app's data model, since they're independent raw
  event counts, not a strict funnel - my first attempt assumed clicks
  implied opens, which doesn't hold here).
- **Fixed the "stuck Running" campaign bug** - reproduced the exact
  reported scenario (a fully-sent campaign with follow-ups enabled) and
  confirmed status='running' was technically correct in the database
  (the scheduler genuinely needs to keep watching for a future follow-up
  window), but showing that as a blinking "Running" indicator was
  misleading since nothing is actually happening for days. Now shows
  "Follow-ups pending" instead, and the header indicator no longer
  blinks for a dormant campaign. Verified both fixes directly.
- **Campaigns list is now grouped by niche** (as section headings) with
  a 3-column grid underneath each, plus a location badge showing each
  campaign's dominant city/country. Verified with a real screenshot
  across two niches.
- **Pagination added to Tracking and History**, matching the Board
  page's own pattern - verified across a real 65-email dataset spanning
  two pages, including catching and fixing a bug in my own first attempt
  (an uninitialized page counter produced "NaN" row numbers on first
  load).

## What's in this V15.12
Fixed a real correctness bug in reply detection, confirmed directly
against your own inbox screenshot - out-of-office and automatic replies
were being counted as genuine replies.

- **Auto-reply/bounce filtering added** - checks the RFC 3834
  Auto-Submitted header plus the common non-standard headers various
  mail systems use instead (Auto-Submitted isn't set reliably by every
  system, including some Exchange configurations), with subject-line
  patterns ("Out of Office," "Automatic reply," "Undeliverable," etc.)
  as a fallback for systems that set neither. Verified against the exact
  messages from your screenshot - a real reply passed through correctly,
  the out-of-office and automatic-reply messages were correctly excluded,
  and a bounce notification was correctly excluded too.
- **Fixed the timestamp bug that caused the "6 replies at the same
  minute" confusion**: replied_at now uses the message's own Date header
  instead of "whenever the check happened to run" - this is what made a
  backlog from the first-ever check look like a burst of simultaneous
  replies rather than what it actually was, a month of accumulated
  inbox activity processed in one pass.
- **Added a way to correct the false positives already in your
  database** from before this fix existed - each replied email now has
  a "not a real reply?" link that clears the mark (and un-blocks any
  follow-up that reply had been suppressing). Verified end-to-end: mark
  cleared from both the detail panel and the database.

## What's in this V15.11
Reply detection - the ground-truth engagement signal opens/clicks can't
provide, since both of those can fire from mail-client prefetching or
corporate security scanners with no human ever involved.

- **Every account with IMAP configured gets checked automatically**,
  every 15 minutes, for genuine replies. Built to be efficient: one
  inbox scan per user (not one per recipient), only looking at what's
  arrived since the last check, then cross-referenced in memory against
  everything sent - not a slow per-email IMAP round trip.
- **Surfaced everywhere it matters**: a "replied" badge in Tracking, a
  prominent green confirmation in the email detail panel, and a new
  "Replied" stat card on Reports, sitting right next to Sent/Opened/
  Clicked as the number actually worth trusting.
- **Deliberately doesn't touch the existing status column** - only adds
  a separate replied_at timestamp - since Reports' opened/clicked counts
  are keyed directly off that status value, and overwriting it would
  have silently made a replied-to email disappear from those counts.
  Verified this specifically: an email that had already reached
  "clicked" correctly stayed "clicked" after a reply arrived, with
  replied_at set alongside it, not replacing it.
- Verified end-to-end with a mocked inbox: case-insensitive address
  matching, a non-matching recipient correctly left alone, and an
  already-detected reply correctly skipped on a second pass rather than
  reprocessed. Also verified the incremental "since last check" behavior
  actually narrows on the second run instead of re-scanning.
- Also feeds directly into the follow-up sequence feature from the
  previous release - a reply this checker catches means no follow-up
  gets sent for that lead, without needing its own separate config.

## What's in this V15.10
Follow-up sequences for Auto Send campaigns - automatically nudges a
lead who hasn't replied, with a real inbox check before each one.

- **A lead who hasn't replied after N days gets a short, natural
  follow-up** - not a repeat of the original pitch. The AI is given the
  actual prior email as context and told explicitly to write a brief
  bump (2-4 sentences), not re-explain the business's problem from
  scratch. Threaded with a "Re:" subject against the original.
- **Safety-checked before every send**: the scheduler connects to your
  inbox via IMAP and checks for any reply from that lead before sending
  a follow-up. If they replied - even just to decline - no follow-up
  goes out, and no further follow-ups are attempted for that lead.
  Verified this exact scenario directly: a lead who replied correctly
  got skipped, a lead who didn't correctly got a follow-up with the
  right threaded subject and content.
- **A real bug caught and fixed during this build**: the follow-up
  scheduling check was placed after the existing send-pacing gap check
  in the scheduler, which meant a recent send from any lead in the
  campaign could block the reply-check for a completely different lead.
  Fixed and reverified with the same failing scenario, deterministically
  (zeroed pacing gap) to remove any doubt.
- **Campaign completion logic corrected** - a campaign with leads still
  waiting on a future follow-up no longer gets marked "completed"
  prematurely just because nothing is immediately queued.
- Configurable per campaign (both creating and editing): enable/disable,
  max number of follow-ups, days to wait between touches - available on
  both the campaign creation and edit forms, verified through the actual
  UI end to end, not just via direct API calls.
- Migration verified safe against a realistic pre-upgrade database with
  real campaign data present - existing campaigns default to follow-ups
  off, existing leads default cleanly to touch 1.

## What's in this V15.9
The actual root cause behind the still-blank message content, and a
working browser back button (the previous attempt at this had a bug of
its own).

- **Found and fixed the real bug behind the blank Message box** - not
  missing data, a rendering bug. The email's HTML was being escaped with
  a function meant for placing text between tags (which doesn't escape
  quotes), then inserted into a `srcdoc="..."` attribute (which does
  need quotes escaped). Any ordinary `<img src="...">` or `style="..."`
  in the email - which is nearly every real email, since your own
  signature has one - would prematurely end that attribute and corrupt
  everything after it, rendering nothing. Fixed with a proper attribute-
  safe escaping function, verified against a realistic email body
  (image + link, matching your screenshot) rendering correctly end to
  end via direct frame inspection, not just a screenshot.
- **Fixed the browser back button** - the first attempt at this (rushed
  in the previous round) turned out to conflict with a more capable,
  already-existing implementation from an earlier session that I hadn't
  checked for first. Removed my duplicate and found a real bug in the
  existing one instead: it silently no-opped when returning to the
  default view because that shortcut, correct for page-refresh, doesn't
  hold for back/forward, where the current view could be anything.
  Verified stepping back through multiple views and forward again lands
  on the correct view every time, and confirmed page-refresh restoration
  still works correctly afterward.

## What's in this V15.8
A critical regression fix, a real bug found behind missing message
content, unlimited daily sending, retry for failed leads, S/N columns,
and corrected alert icons.

- **Fixed a critical regression from the previous release**: the
  Country-tree CSS change accidentally broke the Contacted section's
  Hostinger/Gmail platform tree, which reuses the same CSS classes for
  an unrelated purpose - Hostinger and Gmail wouldn't expand at all,
  blocking access to Tracking/History/Alerts/Auto Send entirely. Fixed
  with a precise selector, verified both that the platform tree works
  again and that the Country-tree isolation didn't regress back.
- **Found and fixed a real gap behind missing message content**: emails
  sent via the browser extension never captured the compose body at all
  - only automated campaign emails did. Added an endpoint plus extension-
  side code (Gmail and Hostinger) to report the final HTML back after
  the tracking pixel is injected, so manually-sent emails now show their
  content in the Tracking detail panel too.
- **Daily email sending limit removed** - verified a campaign can be
  created with a limit far above the old hard cap of 100.
- **Retry button** added next to Skip for a failed campaign lead - resets
  it to pending so the scheduler tries again on its next tick, for when
  a failure looks transient rather than something to give up on.
- **S/N (row number) columns** added to campaign lead rows, Tracking,
  History, and Alerts.
- **Alert icons corrected** - opens show an open-envelope icon, clicks
  show a link icon, verified directly against real data.
- **Alerts page gained its own "Clear all" button** - a genuine delete,
  since Alerts is the source-of-truth page for this data (unlike the
  header notification feed, which only dismisses from its own view).

## What's in this V15.7
Item 7 - the pipeline tree restructured to Niche > Country > City > Leads,
applied consistently across Hunt, Reach Out, Pinned, and campaign
creation.

- **Every catch log now has a country**, backfilled to "Unnamed" for
  existing ones (you'll rename these manually, as planned). Migration
  tested against a realistic scenario: a full production-shaped database
  with the country column dropped to simulate your exact pre-upgrade
  state - confirmed the migration backfills correctly and every existing
  lead survives untouched.
- **All three sidebar trees rebuilt** - Hunt, Reach Out, and Pinned all
  now show Niche > Country > City > Leads instead of Niche > City >
  Leads. Each verified in a real browser with data spanning two
  countries, confirming cities land under the right country and (for
  Reach Out specifically) that the deeper per-status drill-down still
  works correctly once nested one level deeper.
- **Edit a catch log's country** via its "..." menu → "Edit country" -
  this is how the "Unnamed" ones get renamed to their real country.
- **Hunt form** gained a Country field with autocomplete from countries
  you've already used, while still accepting a new one freely.
- **Campaign creation's city picker** now groups cities by country too,
  verified with a real screenshot showing the grouping rendering cleanly.
- Two stale "Niche → City" breadcrumb hints in the sidebar updated to
  reflect the new structure.

## What's in this V15.6
Item 5 - full mobile responsiveness. Item 7 (Niche > Country > City tree
restructuring) still ahead.

- **Removed the device-width block overlay entirely.** The app now
  renders and works on real mobile screens instead of gatekeeping access
  behind a "use a laptop" message.
- **Sidebar becomes an off-canvas drawer on mobile** - opens via a new
  hamburger button, closes via its backdrop or automatically whenever you
  actually navigate somewhere (not on every tap, which would have made
  the tree impossible to drill into on a touchscreen).
- **A real bug caught and fixed during testing**: the lead expand panel
  was inheriting the leads table's horizontal-scroll min-width (meant for
  the many-column table itself), so its content was getting cut off
  instead of wrapping to the screen - not a decision, a mistake, found by
  actually opening a lead's panel on a simulated 375px phone and looking
  at the screenshot.
- **The PWA install banner was overlapping page content** on mobile
  (dedicated buttons like "Save profile changes" or "Export backup" were
  sitting right behind it) - made more compact and content areas given
  enough bottom padding to scroll clear of it.
- Verified with real screenshots at 375px (iPhone SE - one of the
  narrowest common screens) across the board, Reports, Contacted
  tracking + detail panel, campaign creation, the notification panel,
  and a lead's expand panel, plus a 768px tablet pass - all clear of
  horizontal overflow. Confirmed the desktop layout is completely
  unaffected by any of this.

## What's in this V15.5
Items 1, 2, 3, 4, and 6 complete and verified; items 5 (mobile
responsiveness) and 7 (Niche > Country > City tree restructuring) still
ahead - both large enough to deserve dedicated focus rather than rushing.

- **Fixed the DeepSeek "empty response" bug** at its actual root, found
  through real research rather than guesswork: DeepSeek's V4 models
  default to "thinking mode" enabled, where the model can spend its
  entire token budget on internal reasoning and never produce a visible
  answer - confirmed directly against DeepSeek's own official API docs.
  Fixed by explicitly disabling thinking mode. Verified the exact request
  body sent to each provider, confirming Groq is correctly unaffected by
  this DeepSeek-specific change.
- **Fixed signature images not reaching recipients** - they were stored
  as relative URLs, which mean nothing to an external email client the
  way they do to a browser. Now resolved to absolute URLs before
  sending, verified end-to-end. Also added meaningful alt text derived
  from the uploaded filename, instead of empty strings.
- **Real-time campaign status** - each lead's status pill now updates
  live as a campaign runs, without a manual refresh. Verified with the
  strictest test available: updated the database directly with zero page
  interaction, confirmed the UI updated on its own through polling alone.
- **Full-width content** - removed a leftover 780px cap on Settings
  pages; the rest of the app's primary content areas (board, tables,
  campaigns) were already using the available width correctly.
- **Auto-pin on open/click** - a lead is automatically pinned the moment
  their email is opened or clicked, with a visible "Pinned reason" hint
  in their expand panel. Applies to campaign-sent emails specifically,
  since that's the only path with a reliable email-to-lead link.
  Verified end-to-end against the database, confirming both the pin
  itself and the correct reason text.

## What's in this V15.4
Signature image storage rebuilt properly, image resize/linking added, a
real notification-feed data-isolation bug fixed, and OpenCode AI wired in
as a 4th provider.

- **Fixed the "signature too long" error at its root**, not just the
  symptom. The real problem was that uploaded images were embedded as
  base64 directly in the signature text - any image at all could blow
  past a reasonable length limit. Rebuilt properly: uploads now save to
  disk (same persistent location as the database) and the signature only
  holds a short reference URL. Verified end-to-end, including that a
  1.5MB upload that would have previously failed now succeeds cleanly.
- **Image resize and image-linking** in the signature editor - click an
  image to select it, choose a size preset, add or remove a link. Caught
  and fixed a real bug during testing: the link dialog's own confirm
  button was clearing the image selection before the link code ran,
  since it lives outside both the editor and the image's own toolbar.
- **Fixed a real data-isolation bug**: clearing the header notification
  feed was hard-deleting from the same table the Alerts page reads from,
  silently wiping Alerts data too. Fixed with a "dismissed from feed"
  flag that hides items from the header bell without touching the
  underlying record - verified directly: cleared the feed, confirmed it
  emptied, confirmed Alerts still showed the same entry afterward.
- **OpenCode AI (DeepSeek V4 Flash, free tier) added as a 4th provider**,
  matching your existing Groq/Gemini/DeepSeek setup exactly - same
  key-management UI, same fallback-chain logic, positioned last given its
  free tier's commercial-use terms aren't clearly documented (flagged
  directly in the Settings page itself, not just in chat). Verified the
  client builds correct requests against OpenCode's real API shape, and
  that the full fallback chain correctly includes it once a key is
  configured. The specific key provided has not been saved anywhere -
  add it via Settings → OpenCode AI once this is deployed.
- Both new database migrations (signature/notification schema changes)
  verified against a simulated pre-upgrade database - existing data
  survives intact.

## What's in this V15.3
Everything from the follow-up round, plus item 9 (IP/city/browser/OS/
device logging) finally completed.

- **Investigated a reported bug with real end-to-end testing, not just
  code inspection**: re-ran the exact campaign pipeline and confirmed
  content-saving and email-body-saving both work correctly on this
  version. The specific email in question predates these fixes - they
  only apply going forward, not retroactively to already-sent emails.
- **Signature image upload** tightened to spec: PNG/JPEG/WEBP only, 2MB
  cap (previously a generic 1MB).
- **Skipped leads excluded from campaign progress** - the progress bar
  and header indicator now show sent-vs-actionable-total, not sent-vs-
  everything-including-unreachable-leads. Verified with a real mixed
  campaign (sent/skipped/pending all present).
- **Delete/clear controls added**: a trash icon on every History event
  plus a "Clear all" button, and the same for the notification feed -
  both backed by real delete endpoints, not just hidden client-side.
- **Item 9 - who opened/clicked, and from what**: every open and click
  now records browser, OS, and device (parsed locally from the user
  agent - no external service, no reliability concerns) plus city/country
  via IP geolocation. Shown in both the History table and the Tracking
  detail panel.
  - **Important caveat worth knowing**: the free geolocation lookup used
    here is documented by its provider as non-commercial use only. This
    app is a commercial tool, so before relying on this in production,
    either confirm current terms allow it or swap in a paid geolocation
    provider - the code is structured so that's just a URL change.
  - A real bug was caught and fixed during this build: the single-email
    detail endpoint's opens/clicks query hadn't been updated to include
    the new columns, so while History showed the new data correctly, the
    Tracking detail panel silently didn't. Caught via a full round-trip
    browser test, not a syntax check.

**On OpenCode AI as a 4th provider**: not implemented this round, pending
your decision - see the write-up in the previous message for the
commercial-terms caveat that's worth weighing first.

## What's in this V15.2
Items 4, 6, and 7 complete and verified; items 5, 9, 10 still ahead.

- **All Contacted timestamps now show UTC+5, 12-hour AM/PM** - storage
  stays UTC in the database (correct practice), this is purely a
  display-layer conversion, applied everywhere a timestamp appears
  (Tracking, History, Alerts, campaign cards, campaign lead rows, the
  notification feed). Verified against known day/midnight/year-rollover
  edge cases, then confirmed in a real browser against the raw UTC value.
- **A live campaign progress indicator in the header** - envelope icon
  with a sent/total counter next to the daily lead cap, blinking only
  while a campaign is actually running, stopping the moment it completes,
  pauses, or is cancelled. Clicking it jumps straight to Auto Send.
- **Notifications are now clickable** - clicking one in the header feed
  takes you straight to what it's about: a campaign event opens that
  campaign's detail page, a tracker alert opens that email's tracking
  detail. Verified both paths end-to-end in a real browser.

## What's in this V15.1
Progress on the latest round - items 1, 2, 3, and 8 complete and
verified; items 4, 5, 6, 7, 9, 10 still ahead.

- **Fixed the "Bad recipient address syntax" crash** - malformed scraped
  email addresses (concatenated addresses, obfuscated text mistaken for
  an email, stray whitespace) are now caught before they're ever handed
  to SMTP, both at campaign creation and as a send-time safety net.
  Tested against 18 real-world malformed cases, including the exact
  "two addresses stuck together" pattern that caused the original error.
- **A real bug found and fixed**: content generated by an automated
  campaign was never being saved anywhere the lead's own "Generate
  Content" panel could see it - only baked into the sent email. Verified
  fixed: campaign-generated content is now retrievable from the lead's
  standard content panel exactly like manually-generated content.
- **Skip button for failed campaign emails** - a bad lead can now be set
  aside (not retried) and the campaign resumes with the rest of the
  queue, rather than needing every failed lead retried via a full resume.
  Verified end-to-end including that the other pending lead is untouched.
- **Multiple cities in one campaign** - pick a niche, then check as many
  cities as you want; leads are pooled across all of them into a single
  campaign. Verified with a real two-city campaign correctly including
  leads from both.

## What's in this V15.0
**Item 7 - a real rich-text signature editor.** Replaces the plain
textarea with a genuine WYSIWYG editor: bold, italic, underline, links,
images, bullet lists, and a raw-HTML source toggle for direct control.
Signatures render with real formatting everywhere they appear - the
content preview, and actual sent campaign emails.

This required restructuring how the body and signature flow through the
app - previously they were concatenated into one string early on, which
would have either broken plain-text escaping or mangled the HTML
signature. They're now kept separate end-to-end: generation, on-screen
display (signature fetched live, so an edit is reflected immediately
without regenerating anything), the Copy button (a plain-text rendering,
since rich formatting can't survive a clipboard paste anyway), and
campaign-sent emails (the signature goes in as real HTML, with any links
inside it click-tracked exactly like links in the body).

**A real bug caught during testing, not after**: the actual default
signature applied to new accounts lived in a second, separate place in
the database migration logic that I initially missed updating - it was
still producing the old plain-text version with literal line breaks
instead of real HTML. Caught by an end-to-end browser test on a fresh
account (a syntax check alone would never have found this), fixed, and
reverified.

Verified with a full pipeline test using a real signature containing
bold text, a hyperlink, and an image: confirmed the body is correctly
escaped while the signature renders as genuine HTML (not literal escaped
tags), confirmed the signature's link is correctly rewritten through the
click-tracking redirect while keeping its display text, and confirmed
the image comes through untouched.

## What's in this V14.9
Items 3, 5, and 6 from the latest round - completed and verified.

- **Campaign lead rows now show full Inspection/Content/Website details**,
  not just campaign-specific status - clicking a row loads the same
  Inspect/Generate Content/Freebie Website panel used everywhere else in
  the app, so you can see exactly what was done for that lead during the
  campaign. Built by carefully extracting the shared wiring logic out of
  the Reach Out board's 357-line expand function - verified the original
  board still works identically afterward.
  - **A real bug caught before shipping**: adding a new single-lead API
    route would have silently broken the Pinned board and website-
    generation status polling, since Express matches routes in
    definition order and a wildcard placed too early shadows everything
    more specific below it. Fixed and verified with distinct error
    messages proving each request now reaches its correct handler.
  - A lead's pipeline status now automatically advances to "Contacted"
    the moment a campaign successfully sends to them.
- **Email content is now visible in History, Tracking, and Alerts** - not
  just metadata. Rows are clickable and show the actual sent message in a
  sandboxed preview, for campaign-sent emails (which the app generates
  and therefore has the content for). Manually-sent emails via the
  extension show a clear note instead, since only tracking metadata is
  ever reported for those.
- **Smarter, more human outreach writing**:
  - Uses the lead's actual owner name for the salutation when you've set
    one (new editable field on each lead), falling back to a cleaned-up
    business short name otherwise - tested against real German/English
    business names with legal suffixes, ampersands, and hyphens until it
    produced clean results across the board.
  - SSL/HTTPS findings are now de-emphasized rather than leading the
    pitch - still mentioned when relevant, just not as the main hook.
  - Rewrote the writing-style instructions to push for concrete figures
    and a problem-first framing, per your request.

## What's in this V14.8
Progress on the latest round of fixes - items 1, 2, and 4 complete and
verified; items 3, 5, 6, 7 still ahead.

- **Content-cutoff fixed properly this time**: the campaign panels had the
  exact same missing-overflow bug as before. Rather than patch it again,
  replaced the fragile "remember to list every panel ID" approach with a
  reusable `simple-panel` class - any current or future Contacted page
  just needs the class, not a CSS update.
- **Sidebar tree now genuinely scrolls within itself**: Contacted's
  Hostinger/Gmail tree was missing the same wrapper Hunt/Reach Out/Pinned
  already use for this - fixed, and verified the expanded section now
  correctly fills remaining height and scrolls internally rather than
  pushing Reports/Settings out of reach.
- **Fixed the broken-link bug**: a link immediately followed by
  punctuation (e.g. "book here: https://cal.com/you/15min.") was
  including the trailing period as part of the URL, breaking it. Verified
  across periods, commas, and parentheses.
- **Full campaign management**: campaigns can now be renamed, reconfigured
  (tone/length/language/CTA/meeting/provider/pacing), and deleted -
  verified end-to-end including that editing is correctly blocked while a
  campaign is actively running (pause first) and correctly cascades on
  delete with zero orphaned records left behind.

## What's in this V14.7
**The three remaining UI requests from this round, all completed and verified.**

- **Contacted's sidebar now matches Reach Out's tree exactly** - rather
  than approximate the look, it reuses Reach Out's actual tree CSS
  classes directly, so Hostinger/Gmail's connector lines, rotating caret,
  and spacing are pixel-identical to Hunt and Reach Out, not just similar.
  Confirmed visually via screenshot.
- **Campaign rows are now expandable**, showing the actual recipient
  email in the row itself, and clicking reveals subject line, open/click
  counts, first-opened time, errors, and contact details - verified
  end-to-end via browser test (expand, collapse, correct content shown).
- **A real, unified notification feed** in the header, next to the theme
  switcher - previously campaign events (paused/completed) only went to
  the server console and weren't retrievable anywhere in the app. Now
  they're persisted alongside tracker alerts (opens/clicks, any platform)
  into one combined, correctly-sorted feed. Verified: badge shows the
  right unread count, opening the panel shows both notification types
  together, clicking one marks it read and updates the badge immediately.

## What's in this V14.6
**The critical Groq token-limit bug is fixed.** When a similar issue was
fixed for website generation earlier, a default of 8,000 output tokens
was accidentally applied to every AI call in the app, not just website
generation - meaning regular content generation and inspection were
requesting more tokens than Groq's free-tier ceiling allows, on every
single call. Lowered the default to 2,000 (still generous for an email
or analysis writeup) and verified precisely: mocked the network layer so
the real code actually ran, confirming a normal call now requests 2,000
tokens while website generation's own larger value is untouched.

- **Separate default AI providers** for content generation vs. inspection,
  configurable in Account Settings - inspection previously had no
  provider choice at all. Priority order verified: an explicit campaign
  choice wins, then your saved default, then Auto.
- **Gmail now has its own setup fields** (Gmail address + App Password)
  instead of reusing Hostinger's SMTP form. Found and fixed a real bug
  while building this: both platforms' Setup pages shared one "only
  attach listeners once" guard, so whichever platform loaded first
  silently claimed it and the other's Save button did nothing - verified
  fixed by testing Gmail-first, then Hostinger, then Gmail again.
- **Also caught in the same pass**: the auto-refresh dropdown's stored
  default (15 seconds, inherited from the original tracker) never
  matched any of this app's actual dropdown options, so it silently
  showed as unselected - fixed with a self-healing migration for existing
  accounts, verified against a simulated stale value.
- **Collapsed sidebar badge**: now a small dot in the icon's corner
  instead of an oversized badge with nowhere sensible to sit - confirmed
  visually via screenshot.
- **"Add organically" and "AI provider" rows merged** into one, as
  requested.

## What's in this V14.5
**Automated email campaigns - "Auto Send" under Hostinger.** The largest
single feature in this app's history: pick a niche and city, and it works
through every lead with an email on file automatically - inspecting
uninspected ones first if you ask it to, generating personalized content
with your chosen tone/CTA/meeting link/language, sending through your own
Hostinger SMTP, and tracking every open and click exactly like a manually
sent email would be.

- **One send, three consistent copies**: the exact same message that gets
  emailed is also what appears in your Hostinger Sent folder (via IMAP
  append) and what's tracked in Contacted - built from a single raw
  message rather than reconstructed three times, so there's no risk of
  them drifting apart.
- **Randomized 5-10 minute gaps** (configurable) between sends, capped at
  100/day, specifically to avoid looking automated to spam filters.
- **Inspect-first pipeline**: when requested, a lead gets inspected before
  its email is written, so the message can reference real findings rather
  than generic filler - verified this runs in the correct order.
- **Pause-and-notify on failure, exactly as specified**: a real send
  failure pauses the whole campaign (not just that lead) rather than
  silently skipping ahead - verified with a simulated failure. Resuming
  correctly retries the lead that failed rather than abandoning it -
  verified the retry succeeds once whatever caused the failure is fixed.
- **Leads without an email on file are automatically excluded** at
  campaign creation, with a live count shown before you commit.

Every layer was verified against real database state, not just logs:
campaign creation and SMTP validation, the full inspect-generate-send
pipeline, pause-on-failure, resume-and-retry, and the complete UI flow
end-to-end through a real browser (form → creation → start → running →
back to list with correct progress shown).

**Two real bugs were caught and fixed during this build, before
shipping**: a placeholder expression that would have always written a
null sender field, and (from the previous version's tree restructuring)
a JavaScript initialization-order bug that only a live browser test
caught, not a syntax check.

## What's in this V14.4
**Gmail support added, Contacted restructured into a platform tree.**

- **Sidebar rebuilt as Platform > Subpages**, matching Hunt's niche/city
  tree pattern: Hostinger and Gmail are now expandable nodes, each with
  its own Tracking, History, Alerts, Reports, and Setup underneath -
  verified with a real browser test confirming correct expand/collapse
  behavior and that each platform's pages only ever show that platform's
  data (tested with real mixed Hostinger/Gmail records).
- **Gmail fully wired up**: your `content-script-gmail.js` ported in
  alongside Hostinger's, one combined extension download covers both (no
  second install needed) - verified by actually downloading and
  inspecting the generated zip.
- **Every backend route is now provider-aware** (`?provider=` filtering
  added to emails, notifications, analytics, history, and stats) -
  verified end-to-end with real mixed-platform data.
- **Auto-refresh timer**, fully working end to end: dropdown with all 9
  requested intervals (1 min through 12 hours), persists across reload,
  and the actual timer mechanism verified firing at the correct cadence -
  and only while a Contacted page is actually open, not polling in the
  background when you're elsewhere in the app.
- **Setup page is now platform-aware** - title and instructions correctly
  switch between Hostinger and Gmail depending on which one you're
  viewing, while the API key and extension download stay shared (same
  key, same one-time install, covers both).

**A real bug caught during this build, not after**: partway through the
sidebar restructuring, a new state initialization ran before the app's
central state object existed yet (a JS temporal-dead-zone issue) - caught
via a real browser test (not just a syntax check, which wouldn't have
caught it) before anything was packaged, fixed, and reverified.

## What's in this V14.3
- **Subject line separated from email body** - its own field, independently
  copyable, with its own regenerate button that only touches the subject
  (using the already-generated body as context so it stays coherent) -
  verified regenerating the subject leaves the body completely untouched.
- **Content generation now skips platforms the lead has no channel for** -
  a lead with only email+Facebook on file now only generates those two,
  with unavailable platform tabs visibly dimmed and a toast explaining
  what was skipped - verified end-to-end with a real lead record.
- **Fixed raw `**markdown**` showing up in generated content** - the
  generation prompt now explicitly discourages it, and content now
  renders with real bold/italic on screen while the Copy button produces
  clean text with no stray symbols - applies to content already generated
  before this fix too, not just new generations. Caught and fixed a
  related bug along the way: switching to `<br>`-based line breaks for
  display would have silently dropped paragraph breaks when copying, if
  copy hadn't been updated to pull from the original source text.
- **Fixed the invisible "Download extension" button** - traced to a real
  CSS specificity bug (`.settings-body a`'s color rule was unintentionally
  beating the button's own, making its text exactly match its background)
  - confirmed via computed styles before and after.
- **Redesigned the SMTP settings section** - grouped into a bordered card,
  host/port and username/password paired into rows, plus a one-click
  "Use Hostinger defaults" fill for the standard host/port.
- **Extension renamed** to "Xeven Lead MailTracker" throughout.

## What's in this V14.2
Fixes from real testing of the Contacted feature shipped in V14.1:

- **Content cut off on Contacted pages, fixed** - all 5 new panels were
  missing `overflow-y: auto`, which every other panel type in the app
  sets individually. Verified: scrollHeight now correctly exceeds
  clientHeight with scrolling enabled, instead of clipping.
- **Refresh button added** to the Contacted section header, matching
  Hunt/Reach Out/Pinned exactly (including the header-row + caret
  structure those use, which Contacted was missing entirely) - refreshes
  whichever Contacted sub-page is currently open.
- **Fixed a real bug**: visiting the Hostinger Mail Setup page more than
  once stacked up an extra click handler each time, so clicking "Send
  test email" (or any button on that page) fired once per prior visit -
  this is why it arrived 3-4 times. Verified: after visiting the page 3
  times, one click now fires exactly 1 request.
- **Reordered sub-pages** to Tracking, History, Alerts, Reports, Hostinger
  Mail Setup - moved Setup to the end since it's a one-time step, and
  rewrote its copy to make its purpose unambiguous (get your API key,
  install the extension, optionally configure email alerts - then use the
  other four pages day to day).
- **Investigated the "Opened" status not updating.** Confirmed real, non-
  self-tested opens work correctly (verified end-to-end with a genuinely
  different IP and past the grace window). The most likely explanation
  for what was seen: opens from the same network you sent from, or
  checked within the first few seconds, are deliberately not counted -
  this is what stops your own Sent-folder preview from falsely flagging a
  message as opened, and only affects opens, not clicks (which is
  consistent with clicks having worked correctly). Some mail clients also
  block remote images by default, which would prevent the open pixel from
  loading at all. Added clear, detailed logging for every pixel hit
  (recorded or suppressed, and exactly why) so this is easy to confirm
  going forward - visible in the server's console/Coolify logs. Added a
  note about this directly on the Setup page too.

## What's in this V14.1
**New feature: Contacted - email open/click tracking for Hostinger Webmail.**
A full port of a standalone Postgres-backed tracker (backend + Chrome
extension) into this app, merged into its own database rather than run as
a second service - genuinely zero manual setup in code or Coolify.

- **New "Contacted" section** in the sidebar below Pinned, with five pages:
  Hostinger Mail Setup, Tracking, History, Reports, and Alerts.
- **Zero manual setup**: your API key generates itself the first time you
  open the setup page, and the extension downloads as a ready-to-load zip
  with your key and this app's own domain already baked in as its
  defaults - no `.env`, no options-page typing, no Coolify config. Verified
  by actually downloading, unzipping, and inspecting the generated files -
  confirmed the real values were substituted correctly with zero leftover
  placeholder tokens.
- **Per-user, not single-admin**: unlike the original tool, tracked emails,
  API keys, and notification settings are all scoped to whichever user is
  logged in - verified with a second real account that it can't see the
  first user's tracked emails at all.
- **Same tracking mechanics as the original**, ported faithfully: pixel +
  link-rewrite tracking, self-open filtering (own IP + grace period) and
  bot/scanner filtering (mail security gateways, link-preview bots) so
  those don't falsely mark a message as opened - both verified with real
  simulated hits confirming they're correctly suppressed.
- **Full dashboard**: ledger with filters, search, bulk delete, and a
  detail panel with notes and open/click history; a flat History log;
  Reports with range-filtered stats, a line chart, and a day/hour
  engagement heatmap; and Alerts with an unread badge, verified end-to-end
  including mark-all-read correctly clearing it.
- **Email notifications** on open/click, sent through your own SMTP
  account, configurable entirely from the Setup page.
- Scoped to Hostinger Webmail only per current requirements - the ported
  code is structured so Zoho/Gmail support (present in the original) could
  be added back later without a rearchitecture.

Every piece - pixel/click logging, self-open and bot filtering, per-user
isolation, the setup/download flow, and all five dashboard pages - was
verified with real HTTP requests and real browser sessions, not just read
through.

## What's in this V14.0
**Website generation rebuilt around your tested prompt.** Replaces the
3-template system from V13.9 entirely with a single-call, full-page AI
generator using your validated system prompt - one AI call writes the
complete HTML/CSS/JS per business, rather than AI writing short copy for
fixed templates.

- **8 named design styles** (Minimal, Modern, Creative/Bold, Elegant/Luxe,
  Organic/Warm, Corporate/Professional, Playful, Dark/Gallery), selected
  via dropdown as requested - verified all 8 appear correctly.
- **10 color presets plus a "Surprise me" option** that lets the AI choose
  freely - verified both paths reach the prompt correctly (brand-
  authoritative hex codes when a preset is picked, no palette instruction
  when Surprise is selected).
- **Real photos via LoremFlickr**, keyword-derived per business, no API
  key or rate limits - baked into the system prompt's hard rules exactly
  as specified, alongside inline SVG icons, working mobile hamburger
  navigation, and all the other technical rules from your prompt.
- **Clean URLs** (`niche/city/business-name`, no random ID) with
  collision handling verified end-to-end: generating twice for the same
  business correctly gets `-2` appended on the second one, and both
  remain independently servable.
- New optional Services and CTA Goal fields, plus phone/address/social
  handles now auto-pulled from the lead record into the prompt without
  needing to re-enter them.

**Two real bugs found and fixed while building this**, on top of the
core rebuild:
- The AI request timeout (15-20s) was tuned for short copy snippets, not
  a full page that can take 30-90s to generate - fixed and verified the
  longer timeout/token budget actually reaches the AI client. Safe to do
  because every AI call already runs inside an async job runner, so
  nothing here reintroduces the reverse-proxy timeout issue from earlier
  in this project.
- A lead's social media handles were being passed as an unparsed JSON
  string instead of a real object to the prompt builder - caught before
  it shipped.

Verified end-to-end through real HTTP and a real browser session: the
full business context (palette, style, services, CTA goal, phone,
socials) all confirmed reaching the AI prompt correctly, slug collision
handling confirmed with two real generations for the same business, and
backup/restore reverified against the updated schema values.

## What's in this V13.9
**New feature: freebie website generation.** From the Generate panel on any
lead, "Create Website" opens a new section that generates a free,
no-index landing page - a real demonstration of what you'd build for a
prospect, hosted on a shareable link you can send alongside cold outreach.

Built around one key architectural decision: AI never generates raw HTML.
Instead, three hand-designed templates (Modern, Minimal, Standard - each
with a genuinely distinct visual personality, not just three copies of
the same layout in different colors) provide the structure, and AI only
writes the business-specific copy that drops into fixed slots. This is
dramatically more reliable than freeform AI-generated HTML, and keeps
every generated page looking genuinely designed rather than templated.

- **6 color palettes**, decoupled from the templates - any style pairs
  with any palette. Icons via Bootstrap Icons, no stock photo API needed
  (avoids both licensing questions and free-tier rate limits) - visuals
  lean on icons, color, and typography instead.
- **Visual pickers, not dropdowns** - style cards and actual color swatches
  you click, matching the care that went into the templates themselves.
- **Same proven job pattern** as Inspect and content generation:
  start/status/stop with live per-section progress, throttled between AI
  calls to stay clear of free-tier rate limits.
- **Genuinely excluded from search engines - three independent layers**:
  the page's own `<meta name="robots">` tag, an `X-Robots-Tag` HTTP
  header on the serving route, and a `robots.txt` disallow rule.
- **Backup & restore updated for the new table** - applied the lesson from
  an earlier release immediately rather than waiting for it to be
  discovered missing: verified a full export/wipe/restore cycle not just
  recreates the database row but that the restored page is genuinely
  servable at its original link, and that re-importing the same backup
  twice never duplicates anything.

Verified end-to-end through real HTTP requests and a real browser
session: generation completes with live progress, the resulting page is
publicly reachable with all three no-index layers confirmed present, and
generated pages render correctly and responsively with zero horizontal
overflow on both desktop and mobile.

## What's in this V13.8
**Critical fix, found via proactive testing (not reported)**: backup
restore was completely broken for any account with saved outreach
content. When the language-independence feature was added in V13.6, the
`outreach_content` table's primary key changed to
`(lead_id, platform, language)` - but the backup import route was never
updated to match, so it still referenced the old `(lead_id, platform)`
conflict target and was missing the `language` column from its INSERT
entirely. Any restore attempt on a backup containing generated content
would fail outright with a database error.

Found this by running a full, unprompted backup/restore round-trip as a
health check after the last release rather than waiting for it to surface
in your testing. Fixed and reverified the complete cycle: export, wipe,
restore (all fields correct including language), and re-imported the same
backup a second time to confirm no duplication.

Also ran a full smoke test across every route in the app (30+ endpoints
spanning Hunt, Reach Out, Pinned, Inspect, content generation, all 4 API
provider Settings pages, Account Settings, Reports with both exports,
theme, and the PWA assets) - everything else came back healthy.

## What's in this V13.7
- **Rebranded to "Xeven Leads"** everywhere - checked every file, zero
  references to the old name remain. New favicon and PWA icons generated
  from the same brand mark (the orange ring/dot) used throughout.
- **Mobile warning modal fixed** - was getting buried under newer overlays
  (toast/install-banner) added in later versions; z-index bumped well
  above both, and repositioned with 2rem margins on every side as
  requested. Also added a hint about the inspected/content-generated
  checkmark to the existing status/needs legend popup.
- **Every user can now update their own username and password** (admin
  included) from Account Settings, with current-password confirmation
  required - verified exhaustively via real HTTP and a real non-admin
  browser session: wrong password rejected, successful change immediately
  reflected in the session, and confirmed a real login with the new
  credentials works while the old ones no longer do.
- **Reports page now exports to CSV and PDF** - the PDF genuinely embeds
  the actual rendered charts (captured client-side as images, since
  Chart.js only exists in the browser), not placeholder graphics. Verified
  through a real browser test: clicking Export PDF produced a real
  5-page downloadable PDF with correct data and real chart images.
- **New CTA / Meeting / Website toggles in content generation** - opt-in
  icons that shape the generated message: CTA weaves in a clear call-to-
  action, Meeting organically invites a call (with an optional bookable
  link), Website organically references a demo/reference site (with an
  optional link). Links are editable inline right in the generation panel
  and auto-save as your default for next time. Verified end-to-end through
  a real browser: toggled Meeting on, typed a link, generated, and
  confirmed the link genuinely reached the AI prompt.
- **Dark/Light theme shortcut** added next to logout for a one-click
  switch, without touching the full color-customization page which stays
  exactly as it was. Verified the toggle correctly switches and persists
  across a page reload.

## What's in this V13.6
- **Content generation now preserves every language independently** - added
  7 more languages (Hebrew, Hungarian, Russian, Italian, Bengali, Urdu,
  Pashto) alongside the existing 7. Previously, generating in a second
  language would silently overwrite the first language's saved content,
  since the database only tracked one row per lead+platform. Migrated the
  schema so each language is stored independently - verified end-to-end
  through a real browser: generated English, switched to Spanish (showed
  "not generated yet" correctly), generated Spanish, switched back to
  English, and the original English content was still there untouched.
- **Fixed the real cause behind the Gemini/DeepSeek errors**, backed by
  checking the actual current documentation rather than guessing:
  - DeepSeek's "Insufficient Balance" is a genuine account billing state -
    their API is pure pay-as-you-go with no free tier at all, confirmed
    from their own pricing page. A fresh key alone doesn't change that;
    the account needs funds. Also updated the model name off `deepseek-chat`,
    which is deprecated.
  - Gemini's free tier caps out at 10 requests/minute, and generating all
    6 platforms fired 6 requests back-to-back with no delay - almost
    certainly the real cause of the 47-second retry (a per-minute reset,
    not a daily one). Added a 2.5-second throttle between each platform,
    verified with real timing measurement (6 calls spaced ~2.5s apart,
    spanning 12.5s total - comfortably under the limit).
  - Also updated Groq's model off `llama-3.3-70b-versatile`, which Groq
    deprecated on June 17, 2026 with a hard shutdown of August 16, 2026 -
    two weeks away as of this release.
  - Paid/pro-tier keys for any of these three providers will work with no
    code changes - same authentication mechanism, just higher limits.
- **Actually fixed the refresh-button-when-collapsed issue this time** -
  the earlier fix only covered the sidebar accordion's open/closed state.
  The real bug was a second, separate kind of collapse: the whole sidebar
  minimizing to icon-only mode, which hid labels and carets but never the
  refresh button. Verified with a real measurement showing it now
  correctly hides in that state too.
- **Reorganized the Catch Log header layout**: the breadcrumb now sits
  right next to the "Catch log" title instead of far to the right, and the
  icon buttons (info, grid, filter, export) moved up to that same row,
  pushed to the far right - verified with a real screenshot matching the
  requested layout.

## What's in this V13.5
- **Inspect messaging fixed**: removed the confusing "No AI writeup was
  generated..." message entirely. Now shows either the AI provider's icon
  and name (if the writeup was AI-generated) or a simple "Based on
  business place info" label if not - no more mention of a specific
  provider or confusing re-inspect instructions.
- **Generate button repositioned** to the right side, below the tone/
  length/language row, next to the AI provider selector.
- **Failed generation errors now persist visibly** in the output area, not
  just a 5-second toast - if Gemini/DeepSeek generation fails, the real
  underlying error is now readable and reportable, not just glimpsed.
- **Refresh buttons hide when their sidebar section is collapsed** -
  verified via CSS rule tied to the section's open/closed state; Reports
  (which has no collapsible body) is always treated as open.
- **Fallback API key now admin-only** - verified with a real test: created
  an actual non-admin account, confirmed they get a clean "no key
  configured" error with no fallback, then confirmed the admin account
  correctly proceeds past that check and attempts a real call using the
  shared `.env` key (proven by it reaching an actual network attempt, not
  just a theoretical check).
- **Inspected/generated checkmark hint resized and repositioned**: now
  matches the needs icons' exact size (12px) and sits to the right of the
  trash icon in the actions column, instead of the S/N column - verified
  with a real browser test checking computed font sizes and DOM order.
- **Renamed "API Keys" to "Google Places API"** throughout the sidebar and
  page header, so it's clear this page is specifically about the Places
  API, not Gemini/Groq/DeepSeek.

## What's in this V13.4
**Critical fix**: `src/aiProviders.js` had ended up containing leftover
test-mock code instead of the real Groq/Gemini/DeepSeek fallback logic -
meaning every single AI call in the last few shipped versions (Inspect's
AI writeup and all content generation) was silently returning fake "Mock
content" instead of doing anything real. This happened during this
session's testing process and should have been caught by verification
before shipping - it wasn't, because the check used was a diff against
another backup file that turned out to also be corrupted, rather than
checking the actual file content structurally. Restored the real
implementation from an earlier confirmed-good backup and verified it this
time by checking the actual code content directly (provider order, function
names, zero "Mock content" strings) rather than comparing two files that
could both be wrong. Confirmed end-to-end: with no AI key configured, it
now correctly returns a real, honest error instead of fake content.

Also corrected a misunderstanding from the previous round: "select a
platform to generate content" meant choosing which AI provider
(Groq/Gemini/DeepSeek) to use, not which social media platform. Reverted
the single-platform-only checkbox entirely - content generation always
writes all 6 social platforms again, like before. Added what was actually
asked for:
- **AI provider selector** (with icons) - "Auto" uses the normal fallback
  chain; picking Groq, Gemini, or DeepSeek specifically uses ONLY that
  one, no silent fallback, so the choice is honored exactly.
- **Language/translation selector** (with flag icons) - English, French,
  Spanish, German, Portuguese, Arabic, Chinese. The signature stays in its
  original form regardless of the content's language.

Verified together end-to-end: generated all 6 platforms in one run with
Gemini explicitly selected and Spanish selected - confirmed all 6 used
Gemini specifically (not Groq, which would normally go first) and all 6
correctly received the Spanish-language instruction.

## What's in this V13.3
Item 7, the last one from this round - the app is now a real, installable
PWA.

- **Web app manifest + service worker + icons** - generated a proper icon
  (matching the app's existing "◎" brand mark and orange accent color) at
  every required size, including maskable variants for Android adaptive
  icons. The service worker is deliberately minimal: it only caches the
  static app shell (HTML/CSS/JS/icons) for installability and faster
  repeat loads - it never touches anything under `/api/`, since this
  app's lead/job data must always be fresh, not served from a stale cache.
- **Bottom-center install banner** - shows when the browser reports the
  app can be installed (Chrome/Edge/Android via the real
  `beforeinstallprompt` event), with an explicit Install button and a
  dismiss that snoozes the prompt for a week rather than nagging every
  visit. iOS Safari never fires that event at all, so it's detected
  directly and shown its own "tap Share, then Add to Home Screen"
  instructions instead, since there's no programmatic install trigger on
  iOS to hook into.
- Verified thoroughly: confirmed the manifest, service worker, and all
  icon sizes are served correctly: confirmed the banner stays hidden by
  default, and - notably - confirmed the real headless Chromium browser
  used for testing genuinely fired its own native `beforeinstallprompt`
  event once the manifest and service worker were in place, which is real
  confirmation the setup is actually valid and installable, not just
  theoretically correct. Also verified dismiss correctly persists (via
  localStorage) and the banner correctly stays hidden on a fresh reload
  afterward, respecting the snooze window.

## What's in this V13.2
Item 6 complete - a new Account Settings page, and a real audit of backup
&amp; restore that found genuine gaps.

- **New "Account Settings" page** under Settings: Daily Lead Cap and
  Backup &amp; Restore moved here from the API Keys page, plus a new
  **Signature** section - a plain-text editor (supports line breaks,
  links, emoji/icons) that's appended to every generated outreach message,
  replacing what used to be a hardcoded signature in the code. Verified
  the API Keys page still works correctly after the move, and that a
  custom signature actually shows up in generated content instead of the
  old hardcoded text.
- **Backup &amp; restore comprehensively audited and fixed** - found real
  gaps: `api_keys.provider` was silently missing from both export and
  import, meaning every restored Groq/Gemini/DeepSeek key would have come
  back mislabeled as a Google Places key. `business_analysis` (Inspect
  results) and `outreach_content` (generated messages) weren't included
  in backup at all. Also added the newer `page_size` and `signature`
  settings. Bumped the backup format to v2 - old (v1) backups still
  import fine, the newer fields are just treated as absent.
- **Tested exhaustively with real data**: seeded a full account (keys for
  all 3 AI providers, pinned leads, business analysis, outreach content,
  custom settings), exported, completely wiped the database, and
  restored - confirmed every field came back correctly, including
  provider labels. Verified **idempotency** (importing the same backup 3
  times produces zero duplicates) and that importing an **older backup
  never overwrites fresher local data** (simulated a newer local analysis,
  re-imported an older backup, confirmed the newer data survived).

## What's in this V13.1
- **Reports refresh button** now correctly boxed to match Hunt/Reach Out/
  Pinned - it was missing the same bordered container the other three
  have, which is why it looked like it was floating outside its row.
- **Usage chart duration now defaults to 1D** everywhere instead of 90D.
- **Fixed a real, confirmed bug**: the SSL check was comparing the
  *stored* website URL string instead of the *actual final URL* after
  following redirects - so a lead saved with "http://" that genuinely
  redirects to a valid https:// site would incorrectly show "No SSL".
  Proved the exact scenario with a realistic mock and confirmed the fix.
  Also added deeper checks (structured data, image alt-text coverage,
  content depth) and wired the actual extracted page text into the AI
  prompt so the strengths/weaknesses writeup now considers genuine content
  quality, not just structural checks.
- **Contact scraper now respects the current view's filters** (status,
  search, need, inspected-only) instead of indiscriminately scraping every
  lead ever caught in the whole city/log - refactored the query-building
  logic into a shared module so the board and the scraper can never drift
  out of sync on what "current view" means. Also fixed the scrape panel's
  Refresh button, which used to silently leave stale numbers on screen
  after a job finished - it now properly clears the display first.
- **Content generation now supports picking a single platform** - a
  checkbox lets you generate just the currently-selected platform tab
  instead of always all 6, with the button label updating to show exactly
  what it'll generate.
- **Found and fixed a real regression from earlier in this session**:
  while extracting shared query-building logic for the scraper fix above,
  `leads.js` ended up missing an import (`SORT_COLUMNS`) that it still
  referenced twice - a runtime error that a syntax check alone cannot
  catch, since the file was still syntactically valid. This broke loading
  leads entirely in both Hunt and Reach Out. Caught it through real
  end-to-end testing before packaging, fixed it, and then re-verified
  every consumer of that shared logic (every sort option, exports, the
  scraper, pinned leads) to make sure nothing else was affected.

## What's in this V13.0
- **Refresh buttons on all 4 sidebar sections** (Hunt, Reach Out, Pinned,
  Reports) - honestly, this one had been missed in an earlier round
  despite being promised; built and verified this time.
- **Reports page no longer shows API usage** - that content now lives
  exclusively in Settings/Limits Usage. Cleaned up the dead JS behind it
  properly rather than just hiding it.
- **Duration filters (1D/7D/30D/60D/90D/1Y/All Time)** on every provider's
  usage chart, in both the Limits Usage page and each provider's own
  Settings page - verified the actual network requests sent on every
  change, and confirmed real seeded data at different dates gets correctly
  included/excluded per range.
- **"Inspected" filter** in Hunt (toggle button, only shows businesses
  that have been inspected) and a **records-per-page selector**
  (100/150/200/250/300) that persists per-account - verified by reloading
  the page and confirming the saved preference survives, not just an
  in-memory value.
- **Niche, city, and catch log names now auto-capitalize** on both
  creation and rename.
- **New Reports chart**: all pipeline statuses compared side by side
  ("All Hunted" vs New vs Shortlisted vs Contacted, etc.) over whichever
  time range is selected, with count and % shown on hover - verified with
  real varied seeded data that the bar heights exactly match.
- **Fixed the lead-row cursor**: found the CSS class this depended on was
  defined but never actually attached to the rows in JS, so the pointer
  cursor never showed anywhere despite rows always having been clickable.

## What's in this V12.9
This completes the full list from the last round - all 9 items plus
Limits Usage are now done.

- **Charts are now 1.5x taller and resizable** by dragging the bottom-right
  corner (native CSS resize) - verified with a real drag simulation:
  initial height confirmed at exactly 450px (1.5x of the previous 300px),
  and after dragging, both the container AND the Chart.js canvas itself
  correctly grew to match (confirming the resize actually redraws the
  chart, not just resizes an empty box).
- **Limits Usage is now a real, complete picture** - added Groq and
  DeepSeek, which had been missing from this page entirely. Each of the 4
  providers (Places, Groq, Gemini, DeepSeek) now has: a real chart and
  table of actual usage (not just static text), a plain-English
  explanation of what it's used for, a link to where to get a key, and a
  link to the current official rate-limit page - all confirmed via real
  browser testing (4 charts, 4 tables, explanatory text all present).
- **The same usage chart/table now also appears on each provider's own
  Settings page** (API Keys, Gemini AI, Groq AI, DeepSeek AI) - not just
  the central Limits Usage page - reusing the same rendering code in both
  places rather than duplicating it.
- **Links now use the theme's accent color** instead of default blue -
  verified the computed color exactly matches the theme's accent
  (`rgb(255, 106, 61)`).

## What's in this V12.8
- **Modals/popups close on outside-click and Escape** - the confirm modal
  already had outside-click, added Escape for it plus a global handler
  covering every dropdown-style popup in the app.
- **Pointer cursor** on buttons, links, dropdowns, table rows, and other
  clickable elements throughout the app.
- **"1D" report filter** (renamed from "Last 24 hours") now means the
  actual calendar day in a fixed timezone (UTC+5 default) instead of a
  rolling 24-hour window or server-local midnight - verified with an exact
  hand-calculated edge case (3am UTC+5, just past midnight) and confirmed
  with real seeded leads through the actual SQL query.
- **"Show All" icon button** in Hunt's header, a **Reset Filters** button,
  and a **"Most Needed" sort** (using SQLite's JSON1 extension to sort by
  needs-array length) - all verified with real data and real browser
  interaction.
- **Provider hint icons** in both the Inspect and Generate Content
  sections, showing which AI (Groq/Gemini/DeepSeek) actually produced that
  result. Caught and fixed a real bug along the way: a helper function got
  accidentally nested inside another function's scope, which threw a
  genuine `ReferenceError` the moment you switched platform tabs - found
  via the browser console, not just visual inspection.
- **Inspected/generated checkmark** on the S/N column, visible everywhere
  a lead appears (Hunt, Reach Out, Pinned) - built with `EXISTS` subqueries
  joined directly into the existing queries rather than extra round-trips,
  and confirmed via real measurement that the icon (absolutely positioned)
  doesn't affect the column's fixed width.
- **Reach Out now hides niches/cities with zero leads outside "new"** -
  verified with the exact scenario described: a lead shortlisted out of
  Hunt makes its city appear, and reverting that same lead back to "new"
  makes it disappear again. Found and fixed a real bug in the process: the
  cache behind this only cleared when a status change happened while
  already viewing Reach Out, not when it happened from Hunt - so changing
  status from Hunt would leave Reach Out showing stale, wrong results
  until an unrelated refresh happened to clear it. Also added "rejected"
  to the counted statuses and to the visible status list, which had been
  missing.

## What's in this V12.7
This is the big one - three AI providers with automatic fallback, and a
complete rebuild of how content generation works, directly motivated by
the 502 error and hitting Gemini's free-tier quota.

- **Groq and DeepSeek added as full AI providers**, each with their own
  Settings page (key save/test/activate/delete, same as Gemini). Built via
  a shared factory function instead of tripling the code. Caught two real
  bugs before shipping: forgot to register the new pages in the view
  router (they'd load data but never actually show), and a casing mismatch
  between the HTML IDs and the JS ("Deepseek" vs "DeepSeek") that would
  have silently broken every element lookup on that page. Both found via
  real browser testing.
- **Automatic AI fallback chain**: Groq tried first (generous free tier +
  fast), then Gemini, then DeepSeek last. If one fails for any reason -
  no key, rate-limited, network error - it automatically tries the next
  instead of failing the request. Tested through 5 real scenarios: no
  keys, single success, cascading through 2 fallbacks, cascading through
  all 3, and total failure with a clear aggregated error message.
- **Content generation rebuilt as a background job**, the same
  start/status/stop pattern already proven by Inspect. One click now
  generates all 6 platforms at once in the background - no single HTTP
  request stays open long enough to hit any reverse-proxy timeout, which
  is what was actually causing the 502 errors. Tested exhaustively: full
  success, partial failure (one platform failing doesn't kill the batch),
  and cancellation (genuinely halts progress, confirmed by waiting well
  past when it would have naturally finished).
- **Platform tabs no longer regenerate on click** - they now just display
  whatever was already generated for that platform, with a small dot
  indicator showing which platforms are done. Regenerate targets only the
  currently-viewed platform.
- **Generated content is now genuinely permanent** until explicitly
  cleared or regenerated - added a Clear action (per platform). Verified:
  clearing one platform doesn't touch the others, and the clear persists
  after closing and reopening the panel.
- The Inspect feature's AI writeup also now uses the fallback chain
  instead of being Gemini-only.

## What's in this V12.6
- **Real root cause found via the browser diagnostic tool**: HTTP 429,
  `RESOURCE_EXHAUSTED` - the Gemini free tier's daily quota (as low as 20
  requests/day depending on the account) was genuinely exhausted. This
  isn't a bug, it's Google's real limit.
- Tested the app's 429-parsing logic directly against the exact real error
  body from that finding - it parses correctly, ruling that out as a
  separate bug. The remaining mystery ("Unexpected token '<'" instead of a
  clean error) is most likely something specific to that deployment's own
  network path that can't be reproduced from here.
- **Made the frontend self-diagnosing instead of continuing to guess**: it
  now checks the response's content-type before assuming it's JSON. If a
  proxy, CDN, or firewall ever returns something other than JSON again,
  the UI will show the actual raw response content directly (truncated),
  making any future occurrence immediately diagnosable without needing
  server log access at all.
- **Added friendly, actionable messaging for hitting the free-tier quota**
  specifically: extracts Google's exact retry-after time and explains the
  daily reset and the option to add billing, instead of just showing the
  raw API error text. Verified with the exact real error body from
  testing - correctly extracts "58 seconds" and produces a clear message.

## What's in this V12.5
- The improved error message from V12.4 immediately paid off: it revealed
  "Unexpected token '<'" instead of a generic failure - meaning the
  response body started with an HTML tag, not JSON. Checked the auth
  middleware directly to rule it out (it always returns proper JSON on
  session failures, confirmed by reading the code). The remaining
  explanation: something in front of the Node app (Coolify's Traefik
  reverse proxy, or a CDN/WAF if one is in the path) is returning its own
  HTML error page - most likely because the previous 45s Gemini timeout was
  longer than that layer's own timeout, so the proxy's timeout fired first
  and returned HTML before my code's timeout ever got the chance to return
  a clean JSON error.
- Reduced the Gemini request timeout to 20s - comfortably under typical
  reverse-proxy defaults (commonly 30-60s for nginx/Traefik-based setups
  like Coolify) - so this timeout fires first and always returns real JSON.
- Added duration logging for every Gemini call (`[gemini] request
  completed in Xms`) so if this happens again, checking the server logs
  will show definitively whether it's a genuine slow response, a fast
  response followed by something else going wrong, or the request never
  reaching the code at all - rather than guessing blind.

## What's in this V12.4
- **Found and definitively fixed "Could not reach the server" for real this
  time**: the true root cause was a well-known Express 4.x gotcha - the
  framework does NOT automatically catch errors thrown inside `async`
  route handlers (only Express 5 does this natively). The
  `/generate-content` route had no try/catch, so if anything unexpected
  threw, the request would hang indefinitely with no response ever sent,
  until the reverse proxy's own timeout eventually returned an HTML error
  page instead of JSON. Proved this concretely: made the route throw on
  purpose, confirmed it would have hung before the fix, confirmed it now
  returns instantly with a real error message after. Fixed with an
  explicit try/catch on that route, a reusable `asyncHandler` wrapper
  applied to the other routes making real external API calls (Settings key
  test/save), and a global Express error-handling safety net so this class
  of bug can't silently hang a request anywhere else in the app again.
- **New Length selector** next to Tone in the content generator: Detailed /
  Medium / Short / Concise, each mapped to real prompt guidance controlling
  actual output length. Verified end-to-end: generating with a selected
  length actually reflects it, switching platform tabs correctly carries
  the length through automatically (same as tone), regenerating with a
  newly-changed length correctly picks up the new value, and each
  platform's length is saved and restored independently when reopening the
  panel.

## What's in this V12.3
- **Fixed a real, confirmed bug**: Gemini API calls had no timeout at all -
  a plain `fetch()` with nothing to abort it. If Gemini was slow to
  respond, the request could hang indefinitely, and most reverse proxies
  (Coolify/Traefik included) kill idle connections around 60s - cutting the
  connection mid-flight and producing exactly the generic "Could not reach
  the server" error reported. Added a proper 45s timeout with a clear error
  message if it's ever hit.
- **Clarified the "no AI writeup" messaging**: reproduced the key-save-then
  -lookup flow directly and confirmed it works correctly in isolation, so
  the most likely explanation for a stale "no Gemini key configured"
  result is that Inspect was run before the key was saved - "Refresh" only
  re-displays that same saved result, it doesn't start a new check. The
  message now says this explicitly instead of leaving it ambiguous.
- **Fixed the Inspect/Generate panel not being full-width**: found the
  cause - the panel shares the `.list-row` class (for consistent spacing),
  which sets a narrow 9-column grid layout at equal CSS specificity to the
  panel's own full-width flex layout, meaning whichever was later in the
  stylesheet would win by chance. Pinned the fix explicitly instead of
  relying on that. Verified: the panel now spans 96% of its container's
  width (the remaining 4% is just the container's own padding).
- **Inspect/Generate now available everywhere** (Hunt, Reach Out, Pinned) -
  removed the mode restriction that limited it to Reach Out only. Since the
  underlying data was always stored per-lead (not per-view), this needed
  no backend changes - verified working in Hunt mode directly.
- **New "Limits Usage" page** under Settings: shows this month's real usage
  for Google Places and Gemini pulled from your own account, alongside
  Google's commonly-published free-tier reference figures - clearly marked
  as approximate, since these numbers have changed more than once in 2026
  without notice, with links to the official current pages for anything
  you need to rely on exactly.

## What's in this V12.2
This completes the business deep-analysis and outreach content feature
started in V12.1. Every piece below was verified with real browser
interaction (Puppeteer), including a full click-through of the actual UI -
not just API-level testing.

- **Expandable Inspect/Generate panel**: click any lead row in Reach Out to
  open it below the row. Two sections:
  - **Inspect**: rules-based checklist across Website Health, GMB & Local
    SEO, Social Presence, and Reputation, plus an AI-written
    strengths/weaknesses/suggested-services summary (when a Gemini key is
    configured). Live progress while running, with Start/Refresh/Stop
    controls - verified the panel correctly shows the live "current step"
    text while a check is in progress, and correctly renders the full
    scored breakdown once done.
  - **Generate Outreach Content**: pick one of the 7 tones you specified,
    click Generate (starts with Email), then switch between Email/
    Facebook/Instagram/LinkedIn/TikTok/WhatsApp tabs - each tab switch
    auto-generates fresh content for that platform using the same tone,
    with no need to click Generate again, exactly as specified. Every
    generated message ends with the exact signature block you provided.
    Verified live: generated email content, switched to Instagram, and
    confirmed new Instagram-specific content was generated automatically.
  - **Pin button**: pins/unpins the lead directly from this panel,
    confirmed toggling correctly in the browser.
- The GMB/Local SEO scoring deliberately uses only data already captured
  for free during the original hunt (rating, reviews, business status,
  phone, address) - a real correction I made mid-build after checking
  Google's current Places API pricing tiers and finding that fetching
  additional fields (hours, photos) would trigger their expensive
  Enterprise SKU, which would have contradicted the "free tools" goal.

A note on testing methodology for this release: my sandbox's network
cannot reach googleapis.com at all (confirmed via a blocked-host response),
so the live PageSpeed/Gemini/Places calls themselves can only be verified
on your real deployed server, which has normal internet access. Everything
else - the routes, the job orchestration, the live progress system, the
scoring logic, the frontend, and the full click-through UI flow - was
tested for real, including by temporarily swapping in mock versions of the
network-dependent modules to exercise the real code paths, then restoring
the original files afterward (verified byte-identical via diff each time).

## What's in this V12.1
This is a checkpoint of a larger feature still being built (business deep-
analysis, outreach content generation, pinned leads) - the pieces below are
complete and independently verified; the rest is still in progress.

- **Gemini AI key management**: new "Gemini AI" page under Settings, same
  save/test/activate/delete flow as Google Places keys, backed by a shared,
  non-duplicated route factory. Get a free key at aistudio.google.com/apikey.
- **Gemini usage in Reports**: today's usage, all-time history, and a usage
  -over-time chart, mirroring the Places section exactly. Verified both
  sections render correctly side by side with no interference between them.
- **Hunt and Reach Out are now mutually exclusive**: Hunt only ever shows
  leads still at status "new". The moment a status changes to anything
  else, the lead disappears from Hunt and only appears in Reach Out from
  then on - nothing is deleted from the database, it's purely a filtering
  change. Verified end-to-end with real data (a lead moved from "new" to
  "shortlisted" correctly vanished from Hunt and appeared in Reach Out),
  and caught + fixed a real bug in the process: Hunt wasn't refreshing its
  view after a status change since that never used to matter before this
  release.
- Removed the now-meaningless "Status" filter dropdown from Hunt (Hunt only
  ever shows one status now, so filtering by status no longer applies).

## What's in this V12.0
- **Business name column**: location/maps icon moved out of the name
  column into the Social column (always shown by default, clickable to the
  Maps listing). City column narrowed and that space handed to Status,
  which was getting tight. Contact column's icon changed from an
  "unverified WhatsApp" claim to an honest phone/call icon.
- **API usage History section** in Reports: all-time totals per key plus a
  real line chart of usage over time, built on the existing accurate daily
  tracking. Also found and fixed a real gap in backup/restore - it wasn't
  carrying this history at all. Verified with a full wipe-and-restore test:
  seeded 2 days of usage, exported, wiped everything, imported, and
  confirmed the exact numbers came back correctly mapped to the restored
  key.
- **Toast notifications**: bottom-right, fade in/out, auto-dismiss after
  5 seconds. Wired into hunting, delete, status changes, exports, niche/
  catch-log rename & delete, API key save/test/delete, theme save/reset,
  team member create/delete, and backup export/import.
- **Accessibility pass, backed by real WCAG contrast math** (not visual
  guessing): found that in light mode, `accent`/`good`/`warn` only passed
  the relaxed large-text threshold (as low as 3.66:1) - darkened them
  slightly to properly clear 4.5:1 for normal text. Separately found status
  pill colors (New/Shortlisted/etc.) were catastrophically low contrast in
  light mode (as low as 1.68:1, since they were tuned only for dark
  backgrounds) and gave them proper light-mode-specific variants (4.5:1+).
  Also found Reports charts had hardcoded dark-mode-only text and grid
  colors that would have been unreadable in light mode - made them
  theme-aware. All fixes verified by computing actual contrast ratios
  against the real rendered colors, and confirmed via live evaluation that
  switching modes produces the correct accessible values.

## What's in this V11.9
All verified with real headless-browser rendering.

- **Fixed the edit-menu popover being invisible/clipped**: the popover used
  `position: absolute`, and its ancestor (the scrollable sidebar tree,
  `overflow-y: auto`) clips absolutely-positioned descendants regardless of
  z-index - a common CSS trap. Switched to `position: fixed` with
  coordinates calculated from the button's real screen position, which
  escapes the clipping entirely. Verified: with 15 niches forcing the tree
  to scroll, the last niche's popover opens fully visible and within the
  viewport.
- **Fixed the status dropdown overlapping the delete/trash icon**: found
  the actual cause - the dropdown had `min-width: 132px` but its grid
  column was only 122px wide. Matched the widths properly. Verified: clean
  6px gap between them now, zero overlap.
- **Social icons** shrunk slightly (20px → 17px) for more breathing room.
- **Needs indicators**: replaced the plain colored dots with actual icons
  (globe for no-website, location pin for GMB, magnifying glass for Local
  SEO, star for Reviews, shield for Reputation) in the same colors as
  before. Legend popup updated to match.
- **Export filenames** now follow "Niche-City-Date-AppVersion" across every
  export (catch log, niche, and current-view) - tested live, e.g.
  `Car_Wash-Bali-2026-07-31-2026.07.31-11.9.csv`.
- Reduced the review-count font size slightly per request.

**Not included this release, by request:**
- The all-time API usage + history line chart (item #7) - explicitly
  skipped for now. Some inert backend groundwork (an unused endpoint) was
  left in place since removing it added no value, but nothing in the UI
  changed.
- The WhatsApp-registration check (item #6) - no official API exists for
  this; only unofficial third-party services that carry real ban risk to
  whatever number is used to check. Awaiting a decision on how to proceed
  before any code is written for it.

## What's in this V11.8
- **Niche row redesign** (implemented from the confirmed preview): niche
  name now grows to fill available width (bold, 14px), log/lead counts
  shown compactly as "4L | 136R" instead of "4 logs · 136 leads", and
  Export/Rename/Delete are now tucked behind a single ⋮ menu instead of
  three always-visible icons - freeing up space and reducing clutter.
  Verified in a real browser: the popover is hidden until clicked, and
  opens correctly with all three actions present.

## What's in this V11.7
Verified with real headless-browser rendering at common laptop widths
(1366px, 1440px), not just static CSS review.

- **Fixed the right-side cutoff issue** (delete icon, status dropdown, and
  breadcrumb tail all getting clipped): the records table's column widths
  and minimum width were sized for a much wider sidebar than the app
  actually uses now, so on typical laptop screens the table needed
  horizontal scroll to reach the far-right columns - scroll that wasn't
  obvious since scrollbars are hidden. Shrank column widths across the
  board (roughly 20% narrower overall) so the full row - including the
  delete icon - fits without needing to scroll at all. Verified directly:
  at 1366px, the delete button's right edge (1273px) and the full
  breadcrumb's right edge (1289px) both sit safely inside the content
  area's bounds (1334px/1311px).
- **Fixed the same class of bug in the header breadcrumb**: it was
  positioned via `justify-content: space-between` with no wrapping or
  shrink handling, so a long breadcrumb (e.g. "Hunt / Car wash / Bali")
  could silently overflow past the header's right edge. Now wraps to a new
  line if needed instead of getting clipped.
- **Business names**: now Capitalize-cased, 12px, normal weight (400).
- **Active-item highlighting**: clicking into a city now gives a minimal
  background highlight to both the specific active row *and* its parent
  niche (a lighter tint), so it's clear which niche/city/status you're
  inside at a glance - verified both highlight colors render correctly.

Not included in this release: the niche-row redesign (compact "4L | 136R"
counts + 3-dot overflow menu for edit/delete) - a preview was built and
sent separately per request, awaiting confirmation before implementing.

## What's in this V11.6
This is the first release verified with an actual headless browser
(Puppeteer) rendering the real app, instead of reasoning about CSS in the
abstract - so the fixes below are confirmed with real measured data, not
just "should work."

- **Found and fixed the true root cause of the scrolling/overflow bug**,
  confirmed via real computed styles: `setContentView()` was setting an
  inline `style.display = "block"` to show each panel. Inline styles always
  override stylesheet rules regardless of specificity - so `.board-panel`'s
  CSS `display: flex` (needed for its records list to compute a bounded,
  scrollable height) was being silently overridden back to `block` every
  time. Since flex properties do nothing on a non-flex parent,
  `records-wrap` just grew to fit all content instead of being capped to
  the viewport - measured at 2628px tall with **zero** scrollable overflow
  before the fix. Fixed by switching to a CSS class (`view-hidden`) instead
  of inline styles. Verified in a real browser: `records-wrap` is now
  correctly bounded (656px, `scrollHeight` 2627 vs `clientHeight` 655,
  `isScrollable: true`), and a real programmatic scroll actually moved the
  content.
- **Business names capped at 2 lines** (with the full name still available
  via hover tooltip) instead of wrapping unbounded - this was producing
  wildly inconsistent row heights whenever a business had a very long name,
  which was the direct cause of "data not visible/scrollable" in two
  separate screenshots. Verified in a real browser: 40 rows, including one
  with a 74-character name, all render at an identical 63.375px.
- **Sidebar accordion**: opening any section (Hunt/Reach Out/Settings) now
  closes the others automatically - verified in a real browser that only
  one section is ever open at a time.
- **Sidebar tree redesign**: nested Niches/Cities (Hunt), Niches/Cities/
  pipeline-stages (Reach Out), and Settings sub-pages no longer render as
  individually bordered/boxed cards - now a tree with indent connector
  lines, matching the confirmed preview.
- Business name font is now weight 500 / 13px.
- Line chart: added explicit hover tooltips (shows every status's value
  for the hovered date at once) and thinner lines (1.5px, down from
  Chart.js's default 3px).

## What's in this V11.5
- **Fixed a real bug in the new Settings pages**: when API Keys/Colors/Team
  were converted from modals to pages, the `.settings-view`/`.settings-body`
  classes were used in the HTML but I never actually wrote CSS for them -
  meaning the pages had no scroll behavior at all, trapping content like
  Backup & Restore below the visible area with no way to reach it. Added
  the missing `overflow-y: auto` and layout rules; verified the CSS is now
  actually served and the backup endpoint is reachable again.

## What's in this V11.4
- **Business names and city names no longer get truncated with "..."** in
  the records list - they now wrap onto multiple lines instead, so nothing
  is ever cut off/hidden. This was implemented on my best interpretation of
  a screenshot showing truncated names (e.g. "Sydney Premium De...") - if
  that wasn't what "hidden data" meant, flag it and I'll address the actual
  issue specifically.

## What's in this V11.3
- **Legend moved to an (i) popup**: the always-visible color-key column is
  gone; click the (i) icon in the Catch Log header for a popup with
  Status/Needs colors plus a new "RNP" (Rating Not Pulled) definition.
- **Sidebar is now responsive width**: 20vw by default, clamped between a
  220px minimum and 25vw maximum, with the content area auto-filling
  whatever's left - replacing the old fixed 320px.
- **Settings is now three real pages, not modals**: API Keys, Colors, and
  Team live under a new Settings section in the sidebar (Team only shows
  for admins), navigated exactly like Hunt/Reach Out/Reports.
- **Sidebar tree scrolling reworked**: Hunt's niche list and Reach Out's
  city list now flexibly fill available sidebar space and scroll properly,
  matching how Reports and the New Hunt page already behave, instead of a
  fixed-height cap.
- **Reach Out badge counts update instantly**: changing a lead's status
  now nudges the sidebar's pipeline-stage counts in the DOM immediately
  instead of waiting on a full re-fetch. Each pipeline-stage view also gets
  a thin top border in that status's color.
- **"not pulled" → "RNP"** in the Rating column, with a hover tooltip and a
  definition in the new legend popup.
- **Chart tooltips improved**: pie and donut charts now show both the count
  and percentage share on hover, not just the raw value.
- **Mobile block message hardened**: explicit sizing (accounts for mobile
  browser toolbar height via `100dvh`), a tighter breakpoint for very
  narrow phones, and guaranteed centering regardless of viewport quirks.

## What's in this V11.2
- **Fixed the Reports charts for real this time**: confirmed via direct
  testing that Chart.js's CDN (cdnjs.cloudflare.com) was being blocked
  entirely in the browser - not a bug in the chart code or the app's data,
  both of which were verified correct independently. Chart.js is now
  bundled locally and served from the app's own origin
  (`public/vendor/chart.umd.min.js`), so it no longer depends on any
  external CDN or is vulnerable to ad-blockers/network policies blocking it.
- **Catch log layout restructured**: the color legend is now a dedicated
  column capped at `max-width: 30vw` (not full-width and not sticky/pinned)
  sitting beside the records content, which takes all remaining width and
  is fully responsive. The content column itself never overflows or
  scrolls as a whole - only the records list inside it does, independently
  of the legend column.

## What's in this V11.1
- **Found and fixed the real root cause** of the content overflow/scrolling
  issue: `.layout`'s CSS Grid never defined `grid-template-rows`, so its
  single row sized to content instead of being capped to the viewport -
  every earlier `min-height: 0` fix was correct but couldn't matter without
  this. One CSS line fixes it at the actual source.
- **Reports page overhaul**: added real daily-granularity API key usage
  tracking (didn't exist before - only cumulative totals did), a Niche/City
  filter alongside the date range (defaults: Last 24 hours / All niches /
  All cities), and a new line chart showing each pipeline stage's trend over
  time. Removed the "By niche & city" table. API key usage now shows
  **today's** numbers specifically, not all-time totals - verified this is
  genuinely isolated, not just relabeled.
- **PDF exports rewritten as real tables**: proper grid with borders,
  headers, and alternating row shading (not a plain document/list anymore),
  with social platforms shown as small clickable colored icon badges
  instead of text/links - verified via direct text extraction that the
  table structure and icon glyphs are actually present in the output.
- **Bootstrap Icons everywhere**: replaced every remaining social icon
  (including WhatsApp) and any leftover symbol with Bootstrap Icons.
- **Sidebar**: each section (Hunt/Reach Out) now has its own independently
  scrollable tree instead of one long shared scroll; collapsed state now
  only shows icons, strengthened for certainty. Legend stays above the
  heading in both Hunt and Reach Out.
- **Tablet/mobile block**: below ~1024px width, the app now blurs and shows
  a clear "not mobile friendly" message instead of a half-working
  responsive layout.
- **Faster interactions**: deleting a record and changing a lead's status
  in the Reach Out view now update the screen instantly instead of waiting
  on a network round-trip first.

## What's in this V11
- **Fixed a real layout bug**: content could overflow past the viewport with
  no way to scroll to it. Root cause was a broken CSS flex height-cascade
  introduced in V10's sidebar restructure - fixed properly, not just papered over.
- **Fixed blank Reports charts**: canvases were being measured before the
  panel finished its layout pass after switching from hidden to visible.
- **Fixed the Scrape button auto-starting**: clicking it now only opens/closes
  the progress panel and shows read-only current status. A separate
  **"Start scraping"** button actually triggers a scrape. Also fixed a real
  race condition where double-clicking Start (or reopening the panel and
  starting again) could reset the scraper mid-job and corrupt its counts -
  that's now explicitly blocked.
- **Backup & restore** (Settings → Backup & restore): export your entire
  account - every niche, catch log, lead, saved API key, theme, and daily
  cap - as one downloadable file. Re-importing **merges**, never deletes:
  existing local changes (like a status you've already updated) are never
  reverted, and re-importing the same file twice never creates duplicates.
  Tested directly: full wipe-and-restore, and re-import-without-duplicating.
- Collapsed sidebar now only shows icons; clicking any section icon while
  collapsed auto-expands the sidebar back out.
- Legend moved above the "Catch Log" heading (shared by Hunt and Reach Out).
- Swapped every emoji icon (🎨⚙️👤🌙☀️⏻ and the plain ✎/✕ dingbats) for
  Bootstrap Icons.

## What's in this V10 (app renamed to "Xeven Leads")
- **New SaaS-style navigation**: left sidebar with collapsible sections —
  **Hunt** (Niche → City tree, click a city to see its records; "+ New Hunt"
  opens the search form), **Reach Out** (Niche → City → pipeline-stage tree:
  Shortlisted/Contacted/Engaged/Converted/Won), and a standalone **Reports** page.
- **One catch log per niche+city**: hunting a city you've already searched
  now appends new businesses to that same catch log instead of creating a
  duplicate. Existing duplicate catch logs from before this version are
  automatically merged into one on first boot (tested against a realistic
  multi-duplicate scenario - safe, no data lost).
- **No more automatic scraping during a hunt** - contact/social data is now
  exclusively pulled via the manual Scrape button on a catch log.
- **City column** added to the records list and every export format.
- **Per-user daily lead cap**, default 300, editable under Settings (⚙).
- **Reports page**: total hunted + per-status counts, pie/donut charts
  (Chart.js), a by-niche/city breakdown table, and API key usage - all with
  a date-range filter (24h/7d/30d/3mo/6mo/1yr/all time).
- **Functional breadcrumb**: click any part of "Hunt / Niche / City" (or the
  Reach Out equivalent) to jump back up a level.
- Collapsible sidebar (compact/expand), scrollbars hidden everywhere while
  scrolling itself still works, doubled the width of the Settings/Team/Theme
  popups, a smaller always-visible color legend at the top of every catch
  log, and filters collapsed by default.

## What's in this V8
- **Multi-user accounts with private workspaces**: an admin can create member
  accounts (topbar → 👤 Team). Each account's niches, catch logs, leads, and
  API keys are completely private - members can't see or touch each other's
  data. Your original login still works with the same credentials, now as
  the first admin account.
- **Per-user Google API keys required**: since workspaces are private, each
  member adds their own key(s) under Settings - there's no shared/inherited
  key between accounts (the `.env` fallback still exists as a last resort
  for any account with no key of its own).
- **Per-API-key usage stats**: Settings now shows how many Places API
  requests and how many leads each saved key has actually produced.
- **Dedup across repeat hunts**: hunting the same niche + city again
  surfaces new businesses instead of repeating ones you've already pulled,
  tracked per (user, niche, city). Google's Text Search API has a real hard
  ceiling around 60 results per exact query - once you've exhausted that,
  the response tells you (`exhausted: true`) rather than silently returning
  nothing with no explanation.
- **Contact deep-scrape** (separate Python microservice - see
  `../scraper-service`): click the 🔍 icon on any catch log to scrape each
  business's own website for email, Facebook, Instagram, LinkedIn, TikTok,
  and a click-to-call phone number (from `tel:` links, independent of
  whatever Google Places already gave you). A progress panel shows live
  counts (done/scraping/failed/pending), total requests made, and a Stop
  button. Only one scrape runs at a time across all users - everyone else
  gets a clear "busy" message instead of their businesses getting mixed
  into someone else's batch. See "Contact scrape" section below for full
  deployment details and its real limitations.
- **Light/dark mode + full custom color picker**: topbar → 🎨. Every theme
  color is individually editable with live preview, saved per-account.
- **Color legend**: topbar → ℹ️ next to the filters shows what each status
  and need color means.
- **Larger, clearer social/contact icons** in the Social column.
- Responsive layout: below ~900px width, switches from the fixed-height
  dual-scroll-pane desktop layout to a normal scrolling single-column page.

## What's in this V7
- **Collapsible left panel**: click the ‹ arrow to collapse it to an icon
  strip; it stays sticky (fixed in place) while the records list scrolls
  independently, and the records list header stays visible while you scroll
  through a long list
- **Icon-based navigation**: the Hunt/Niches/Outreach tabs and the Outreach
  Report's pipeline tabs are icon-only now (hover for a tooltip); filter
  triggers (Niche/City/Status/Need/Sort) show a small icon instead of a full
  label, and the whole filter row can be collapsed with the funnel button
- **Custom record list** (no `<table>` element): built as a grid layout
  instead, in this column order: S/N, Business (with the location pin icon
  right in front of the name), Contact, Needs, Social, Rating, Status, Remove
- **Needs shown as colored dots**: instead of text chips, each record always
  shows all 5 need-category dots — colored/filled if that need applies to
  this business, dim/outline if it doesn't. Hover a dot to see which need it is.
- **Social Links column expanded**: now scrapes for Email, Facebook,
  Instagram, LinkedIn, and TikTok from the business's own website (see
  caveat below), plus a Phone icon (from the business's already-known
  number, not scraped) for one-tap calling. Only icons for what's actually
  found/available appear — nothing shows for a platform a business doesn't have.
- **Export current view**: the download icon next to the funnel exports
  exactly what's currently on screen (respecting your search/status/need/
  niche/city filters and sort) as CSV, XLSX, or PDF — separate from the
  per-catch-log and per-niche exports in the Niches tab
- **Two new pipeline statuses**: Engaged (purple) and Converted (teal),
  alongside New/Shortlisted/Contacted/Won/Rejected — available everywhere
  status can be set, and as two more tabs in the Outreach Report
  (Shortlisted → Contacted → Engaged → Converted → Won)
- Search Google Places (New) by keyword + location
- Auto-tag each lead: missing website, low review count, low rating, etc.
- **Auto-dedup**: businesses with the same name + same website (typically
  multiple branches of one chain) are collapsed to one pick; the search
  automatically pages through more results to still hit your requested count
- **Login**: single hardcoded user gate (see Access below)
- **Settings → multiple Google API keys from the UI**: add as many keys as
  you want (topbar → ⚙), each with a label, test before saving, switch
  which one is active — no redeploy needed. `.env`'s `GOOGLE_PLACES_API_KEY`
  still works as a fallback if no key is set in the UI.
- **Niches (categories)**: create, rename, delete — full CRUD, custom themed
  popups instead of browser prompts
- **Catch logs**: every search is saved as a catch log under a niche,
  auto-named from the first word of the Location field
- **Pagination + sorting**: 50 records per page by default, sortable by
  Latest first, Name (A-Z), or Rating (high-low)
- **Niche/City quick filters**: jump straight to "all leads in this niche"
  or "just this city" from the board itself
- **Outreach Report tab**: pick a niche, then a city, and see who's at each
  pipeline stage there. Change a lead's status anywhere and it moves
  automatically, since it's just filtering by status, not a separate list.
- **Exports**: catch log → CSV/PDF; niche → CSV/XLSX/PDF; current view →
  CSV/XLSX/PDF (see Exports section for what each format contains)
- WhatsApp click-to-chat icon next to phone numbers (see caveat below)
- Data is never auto-deleted — nothing is removed unless you explicitly
  delete a niche, catch log, or individual record
- SQLite database; auto-migrates older installs into the current structure
  without losing any existing data
- Daily lead cap enforced server-side (default 100/day, configurable)

## Social scraping and avoiding IP blocks — what's actually done
There's no way to *guarantee* a business's website won't block automated
requests using only free resources - only a rotating residential proxy pool
(a paid service) meaningfully prevents that. What this app does instead, to
reduce (not eliminate) the odds of any one site flagging the requests:
- Uses a rotating pool of realistic browser User-Agent strings rather than a
  self-identifying "bot" string
- Adds a small random delay (300-900ms) before each site visit, so requests
  don't arrive in an obvious uniform burst
- Caps concurrency at 4 simultaneous outbound requests, regardless of how
  many leads are in a search batch
- Only ever does one GET request per business (the homepage) - no crawling,
  no repeat visits

This is "polite, low-volume, one-time" behavior, which is a meaningfully
different risk profile than aggressive scraping, but it's still automated
traffic from your VPS's IP, and some sites (especially behind Cloudflare or
similar) will still block it regardless. Expect some percentage of
businesses to simply come back with no social data found, even when they do
have profiles - that's the site blocking or not rendering the data via JS,
not a bug.

- Search Google Places (New) by keyword + location
- Auto-tag each lead: missing website, low review count, low rating, etc.
- **Auto-dedup**: businesses with the same name + same website (typically
  multiple branches of one chain) are collapsed to one pick; the search
  automatically pages through more results to still hit your requested count
- **Login**: single hardcoded user gate (see Access below)
- **Settings → multiple Google API keys from the UI**: add as many keys as
  you want (topbar → ⚙ Settings), each with a label, click "Test" to verify
  one before saving, then "Use this" to make it the active key — no redeploy
  or .env edit needed to add, remove, or switch between keys. Stored in the
  SQLite database; `GOOGLE_PLACES_API_KEY` in `.env` still works as a
  fallback if no key is set in the UI.
- **Per-row status is color-coded**: the status dropdown on each lead row
  uses the app's own themed dropdown (not a native `<select>`), so the
  color always shows regardless of browser/OS — same for the Status/Needs/
  Sort/Niche/City filter dropdowns above the table.
- **Niches (categories)**: create, rename, delete — full CRUD, custom themed
  popups instead of browser prompts
- **Catch logs**: every search is saved as a catch log under a niche,
  auto-named from the first word of the Location field (e.g. "Hamburg,
  Germany" → "Hamburg"), or a name you choose
- **Records**: shortlist, change status, add notes, delete — with a serial
  number (S/N) column that stays correct across pages
- **Pagination + sorting**: the board shows 50 records per page by default
  (Prev/Next controls), sortable by Latest first, Name (A-Z), or Rating
  (high-low) via the Sort dropdown
- **Niche/City quick filters**: two dropdowns above the table let you jump
  straight to "all leads in this niche" or "just this city," as an
  alternative to navigating the Niches tab's tree
- **Location pin icon**: business address is no longer shown as text — a
  small pin icon next to the name links straight to that exact spot on
  Google Maps, keeping rows compact
- **Social Links column**: best-effort detection of Facebook/Instagram/X/
  LinkedIn links from each business's own website (see caveat below)
- **Outreach Report tab**: a third left-panel tab, separate from Hunt/Niches.
  Pick a niche, then a city, and see three sub-tabs — Shortlisted, Contacted,
  Won — listing exactly who's at each stage there. Change a lead's status
  anywhere in the app (including from this report) and it moves between
  these lists automatically, since it's just filtering by status under the
  hood, not a separate list you maintain.
- **Exports**: any catch log → CSV or PDF; any whole niche → CSV, XLSX, or PDF
  (see Exports section below for exactly what each format contains)
- Clickable website links
- WhatsApp click-to-chat icon next to phone numbers (see caveat below)
- Data is never auto-deleted — nothing is removed unless you explicitly
  delete a niche, catch log, or individual record
- SQLite database; auto-migrates older installs into the current structure
  without losing any existing data
- Daily lead cap enforced server-side (default 100/day, configurable)

## Social Links — important caveat
Google Places API has no field for social media profiles or email - there's
no official source for this. What actually happens: for every lead that has
a website, the server visits that site's homepage and scans the HTML for
recognizable Facebook/Instagram/LinkedIn/TikTok links and a public email
address (preferring `mailto:` links, filtering out generic addresses like
`no-reply@` and share-button noise like `sharer.php`). The Phone icon is not
scraped - it's just the phone number Google Places already gave us, shown as
a one-tap `tel:` link. This means:
- Leads with no website never get scraped social/email icons - there's
  nothing to scan
- Some real sites will still come up empty: bot-blocking, JS-only rendering
  (React/Vue sites where links load after the page renders, invisible to a
  plain HTML fetch), slow servers (6-second timeout), or profiles/email
  linked only from a different page than the homepage
- This adds time to each search while Prospect visits every website in the
  batch (bounded to 4 at a time in parallel, with a jittered delay before
  each - see the "avoiding IP blocks" section above)
- It's best-effort, not a guarantee - treat a missing icon as "couldn't
  confirm," not "definitely doesn't have one"

## Access
Sign in at `/login`. On first boot, your original account is created as
the first **admin**:
- Username: `Saeeddev`
- Password: `Saeed@@2026&&`

This is now a real account (bcrypt-hashed in the database), not a hardcoded
check - change the password by logging in as this user (there's no
"change my own password" UI yet; ask and I can add one, or update it
directly via the database in the meantime). As admin, create additional
accounts from the topbar → 👤 Team button. Each account gets a fully
private workspace and needs to add its own Google API key under Settings.

Sessions last 7 days per browser and reset if the server restarts without
a persistent `SESSION_SECRET` set. Deleting a user's account immediately
invalidates their active sessions, not just future logins.

## Exports — what each format actually contains
- **Catch log → CSV**: one file, one section, every record with S/N, name,
  address, Maps link, phone, WhatsApp link, website, rating, needs, status, notes.
- **Catch log → PDF**: same data, laid out as a readable list; business name
  links to Maps, website text links out, "Chat on WhatsApp" is a real clickable link.
- **Niche → CSV**: a single CSV with one section per catch log (a title row,
  then that log's table). A real CSV file can't contain multiple actual
  "sheets" — that's a spreadsheet-app feature, not a CSV one — so this is the
  closest true-CSV equivalent to what you described.
- **Niche → XLSX**: this is the one that gives you literal separate sheets —
  one real worksheet per catch log, each named after that catch log, with
  working clickable hyperlinks (Maps/WhatsApp/website) built as actual Excel
  hyperlink objects, not just plain text. If "each log as its own sheet" is
  the important part, open this one in Excel/Google Sheets rather than the CSV.
- **Niche → PDF**: all catch logs in one document, one per page, same
  clickable-link treatment as the catch log PDF.

Link behavior differs slightly by format: XLSX and PDF have true embedded
hyperlinks. CSV just contains the plain URL text — Excel and Google Sheets
both auto-turn plain http(s) text into a clickable link when you open the
file, but that's the spreadsheet app doing it, not something CSV itself supports.

## WhatsApp icon — important caveat
There's no free API that reliably confirms in advance whether a phone number
is registered on WhatsApp. The icon shown next to phone numbers is a
**click-to-chat link** (`wa.me/<number>`) — clicking it opens a chat attempt,
and WhatsApp itself will tell the user at that point if the number isn't
reachable. It is not a pre-verified badge, just a shortcut to try.

## Dedup behavior — what counts as "the same business"
Two results are treated as duplicates only when they share **both** the same
business name and the same website domain (e.g. two listings both named
"Mr Wash Wandsbek" pointing at `mrwash.de`). Branches of the same chain that
have *different* names (e.g. "Mr Wash Wandsbek" vs "Mr Wash Altona") are
kept as separate leads even though they share a website, since they're
genuinely different locations you might want to approach separately. If you'd
rather collapse all branches of one domain into a single pick regardless of
branch name, that's a one-line change in `src/placesApi.js` — just ask.

## 1. Requirements
- Node.js 18+ installed
- A Google Cloud project with **Places API (New)** enabled and billing turned on
  (Google requires a card on file even to use the free quota — see cost notes below)

## 2. Get a Google Places API key
1. Go to https://console.cloud.google.com/ and create (or select) a project.
2. APIs & Services → Library → search "Places API (New)" → Enable.
3. APIs & Services → Credentials → Create Credentials → API key.
4. (Recommended) Restrict the key to the Places API and to your server's IP.
5. Billing → link a billing account (required by Google, but see quota notes below).

## 3. Install & run
```bash
cd leadgen-app
npm install
cp .env.example .env
npm start
```
Open http://localhost:3000, sign in (see Access below), then either:
- paste your key into `.env` under `GOOGLE_PLACES_API_KEY` before starting, **or**
- skip that and instead click ⚙ **Settings** in the app's topbar, give the
  key a label, click **Test**, then **Test & Save** — no restart needed. Add
  more keys any time and switch which one is active with **Use this**.

## 4. Using it
1. Enter a keyword (e.g. "dentist", "restaurant", "gym") and a location
   (e.g. "Swabi, Pakistan" or a specific city/area).
2. Leave "Include ratings & review counts" **off** for your first searches —
   this keeps every call in the free Essentials-tier quota.
3. Click "Hunt for leads." Results land in the Catch Log below, each already
   tagged with likely service needs.
4. Filter, shortlist, add notes, and update status as you work leads.

## 5. Cost / quota notes (read this before scaling up)
Google retired the flat $200/month credit in March 2025. It's now a free
monthly allowance **per API tier**:
- Essentials-tier fields (name, address, phone, website, business status):
  10,000 free calls/month
- Pro-tier fields (rating, review count): 5,000 free calls/month, but adding
  even one Pro field bumps the **entire call** to Pro pricing

This app defaults to Essentials-only fields for that reason. At 100
leads/day (≈3,000/month), you'll comfortably stay inside the free
Essentials quota. Turn on ratings only when you specifically need
review-count based targeting, and expect to burn through the smaller Pro
quota faster if you do.

The `DAILY_LEAD_CAP` in `.env` is your safety valve — raise it once you're
comfortable with your actual API usage in the Google Cloud Console
(APIs & Services → Dashboard).

## 6. Known limitations
- Google returns at most ~60 results (3 pages of 20) per distinct search
  query, even with dedup/pagination — for very large target counts, run
  separate searches with narrower keywords/areas.
- Phone/website data quality depends on what businesses have filled into
  their Google Business Profile — some fields will be empty.
- Only one contact-scrape job runs at a time across the whole app (all
  users) - the scraper microservice is a single shared instance, not one
  per user.

## 7. Deploying the Contact Scraper microservice
This is a **separate Python service** (in `../scraper-service`, alongside
this Node app), not a module inside it. It needs its own container.

### Why separate
It's built with FastAPI/httpx/BeautifulSoup - a different stack entirely
from this Node app - and runs as its own Docker service. The Node app talks
to it over plain HTTP.

### Docker Compose (recommended)
Run both services together with one `docker-compose.yml` at the level above
both project folders:
```yaml
services:
  leadgen-app:
    build: ./leadgen-app
    ports:
      - "3000:3000"
    volumes:
      - ./leadgen-app/data:/app/data
    environment:
      - SESSION_SECRET=${SESSION_SECRET}
      - SCRAPER_SERVICE_URL=http://scraper:8000
      - SCRAPER_API_SECRET=${SCRAPER_API_SECRET}
    depends_on:
      - scraper
    restart: unless-stopped

  scraper:
    build: ./scraper-service
    volumes:
      - ./scraper-service/data:/app/data
    environment:
      - SCRAPER_API_SECRET=${SCRAPER_API_SECRET}
    restart: unless-stopped
    # No "ports:" - only reachable from leadgen-app on this Docker network,
    # not the public internet. See scraper-service/docker-compose.yml for
    # the option to expose its manual dashboard.html directly instead.
```
Both `SESSION_SECRET` and `SCRAPER_API_SECRET` should be long random
strings, kept the same across restarts - put them in a `.env` file next to
this compose file (Compose reads it automatically) rather than hardcoding them.

### On Coolify specifically
Deploy `scraper-service` as its own Coolify application (Dockerfile build
pack, no public domain/port needed - only add one if you want direct manual
access to its dashboard.html). Deploy `leadgen-app` as usual. Set
`SCRAPER_SERVICE_URL` on the Node app to the scraper's **internal** Coolify
service address (Coolify assigns these automatically when both are on the
same project/network - check the scraper app's "Internal URL" in its
Coolify settings). Set matching `SCRAPER_API_SECRET` on both.

### What it actually finds (and doesn't)
- No headless browser - plain HTTP + HTML parsing only. Sites that render
  contact info purely via JavaScript (common on React/Vue sites) will come
  back empty for those fields.
- No `robots.txt` enforcement, no retries, a flat delay between requests
  (not adaptive to `429`/rate-limit responses). This is the same tradeoff
  profile as the free social-scan already built into search - low-volume,
  one-time-per-business, not an aggressive crawler, but not invisible either.
- The Phone icon in the Social column reflects a `tel:` link the scraper
  found on the business's own site - independent of whatever phone number
  Google Places already gave you (shown separately in the Contact column).

## 8. Upgrading an existing Coolify deployment
If you're updating a server that's already running an older version:
1. Push this updated code to your git repo
2. In Coolify's Environment Variables tab, add `SESSION_SECRET` set to any
   long random string (so login sessions survive container restarts)
3. Redeploy in Coolify as usual
4. On first boot, the app auto-detects any old database schema and migrates
   your existing leads into a niche called **"Uncategorized"** — nothing is
   lost, including each lead's status and notes
5. This version adds a login gate — after redeploying, go to `/login` and
   sign in with the credentials in the "Access" section above before using the app
6. This version also adds `settings` and `api_keys` tables (for the
   in-app API key list) — created automatically on first boot, nothing
   to run by hand. If you previously saved a single key via Settings, it's
   auto-migrated into the new list as "Default" and kept active.

## 9. Where this goes next
When you're ready, we can add:
- Email sending (Gmail API / SMTP) with per-lead personalized templates
- A shortlist → outreach sequence view
- WhatsApp/call integration (with the ToS/cost tradeoffs discussed earlier)
- Proposal PDF generation from a lead's flagged needs
