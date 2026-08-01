# Prospect — Lead Hunting Board (V1)

A self-hosted tool that searches Google Places for businesses matching a
niche + location, flags what service each one likely needs (website design,
GMB optimization, local SEO, etc.), and gives you a board to shortlist and
track them. Capped at 100 new leads/day by default to stay inside Google's
free API quota.

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
