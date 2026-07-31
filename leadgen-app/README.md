# Prospect — Lead Hunting Board (V1)

A self-hosted tool that searches Google Places for businesses matching a
niche + location, flags what service each one likely needs (website design,
GMB optimization, local SEO, etc.), and gives you a board to shortlist and
track them. Capped at 100 new leads/day by default to stay inside Google's
free API quota.

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
