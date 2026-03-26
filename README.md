<div align="center">
<img width="1200" height="475" alt="Boy & A Scanner Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Boy & A Scanner

> AI-powered Radio Frequency Intelligence. Find, verify, and program scanner frequencies for any US location.

**Live app:** [boyandascanner.com](https://boyandascanner.com)

---

## Overview

Boy & A Scanner is a full-stack web application combining Google Gemini AI, the RadioReference database, and Supabase to deliver scanner frequency intelligence for any US location. Sign in with Google, search any ZIP code or city, and instantly get Police, Fire, EMS, and trunked system frequencies — ready to program into your Uniden SDS100/SDS200.

---

## Features

### 5 App Modes
| Mode | Description |
|------|-------------|
| **LOCAL** | Search a single location by ZIP, city name, or current GPS coordinates |
| **TRIP** | Enter origin + destination — AI maps 3–5 scan zones along your route |
| **EXPLORE** | Interactive US map of all cloud-cached locations; tap any marker to browse frequencies instantly |
| **RANKS** | Community leaderboard — earn points by confirming active frequencies with "Heard It" |
| **COMMUNITY** | ScannerSphere hub with forum posts, events calendar, and tutorials |

### Hybrid Data Sources
- **RadioReference SOAP API** — Authoritative verified data for ZIP code lookups (requires RR Premium account)
- **Google Gemini 3 Flash Preview AI** — Live on-demand AI search for city, county, and GPS coordinate queries in the app
- **Deterministic Location Resolver** — Normalizes ZIP, city/state, and county/state searches into the same geographic identity before search
- **Cloud Cache** — Supabase-backed cache keyed by canonical geography with equivalent legacy aliases so ZIP, city, county, and common `St` / `Saint` variants can reuse the same result set

### Export Ecosystem
| Export | Description |
|--------|-------------|
| CSV | Spreadsheet-compatible frequency list |
| Smart CSV | Export only frequencies with a minimum number of community confirmations |
| Copy for Sentinel | Tab-delimited clipboard copy for paste into Uniden Sentinel |
| CHIRP CSV | Format compatible with CHIRP radio programming software |
| Programming Manual | Printable step-by-step SDS100/SDS200 programming guide |
| Trip PDF | Formatted trip manifest with zone-by-zone frequencies |
| SDS100 ZIP | Full Sentinel package with CSVs and import guides per zone |

### Other Features
- **Saved Locations** — Star searches to personal favorites (synced via Supabase)
- **System Type Filter** — Filter results by Analog, P25 Phase I/II, DMR, NXDN, EDACS, LTR, Motorola
- **Service Filter** — 18 service categories (Police, Fire, EMS, Ham, Railroad, Air, Marine, Military, and more)
- **Comparison View** — Pin one location to compare side-by-side with a second search
- **Crowdsource** — Submit field-confirmed frequencies; earn points on the leaderboard
- **User Profiles** — Display name, scanner model, bio, and optional location; synced to Supabase
- **Notification Bell** — In-app notifications for badge unlocks and streak milestones
- **Dark / Light theme toggle**
- **Advanced Search** — Filter by State, City, County, or ZIP with structured form fields
- **Guided Scope Feedback** — The app shows how a query was interpreted and offers one-tap refinement chips for ZIP, city, or county scope when useful
- **RR Refresh Controls** — RR-backed searches can automatically upgrade AI-only cache entries, with a manual `Refresh RR` override when an immediate authoritative recheck is needed
- **Mobile hamburger menu** — Full nav + account actions accessible on all screen sizes

### ScannerSphere Community Hub
- **Forum** — Categorized discussion threads (Equipment, Frequencies, Events, Legal & Ethics, General) with upvoting and threaded comments
- **Events Calendar** — Upcoming scanner conventions, meetups, online Q&As, and swap meets (admin-managed via Supabase)
- **Tips & Tutorials** — 5 static sections covering getting started, programming, best practices, legal/etiquette, and growing the community

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons |
| Auth | Supabase (Google OAuth) |
| Database | Supabase (PostgreSQL) — cache, favorites, crowdsource logs |
| AI | App: Google Gemini 3 Flash Preview (`@google/genai`) • Precacher: Gemini or OpenRouter/Kimi |
| External API | RadioReference SOAP API (premium subscription required) |
| Maps | Leaflet + react-leaflet (CartoDB dark / OpenStreetMap tiles) |
| Export | jsPDF, jszip, custom CSV and Sentinel formatters |
| Deployment | Vercel — frontend + serverless API functions |
| Pre-cacher | Oracle Cloud Free Tier Ubuntu VM (Node.js, split cache/SEO timers via systemd) |

---

## Project Structure

```
├── api/                   # Vercel serverless functions
│   ├── search.ts            # POST /api/search  — Gemini AI frequency search
│   ├── rrdb.ts              # POST /api/rrdb    — RadioReference SOAP wrapper
│   ├── trip.ts              # POST /api/trip    — Gemini trip planner
│   └── exports/sds100/      # SDS100 scaffold endpoints
│       ├── validate.ts      # POST /api/exports/sds100/validate
│       ├── build.ts         # POST /api/exports/sds100/build
│       └── build-zip.ts     # POST /api/exports/sds100/build-zip
├── components/            # React UI components
│   ├── Auth.tsx             # Google OAuth login page
│   ├── SearchForm.tsx       # Simple + advanced location search input
│   ├── FrequencyDisplay.tsx # Agency cards + trunked system tables
│   ├── TripPlanner.tsx      # Route planner UI and results
│   ├── ExploreMap.tsx       # Interactive Leaflet cache map
│   ├── Leaderboard.tsx      # Community rankings + personal stats
│   ├── ComparisonView.tsx   # Side-by-side location comparison
│   ├── ProgrammingManual.tsx# Printable SDS100/200 manual modal
│   ├── CommunityHub.tsx     # ScannerSphere — forum, events, tips & tutorials
│   ├── ProfileModal.tsx     # User profile editor (display name, scanner model, bio, location)
│   └── ...
├── services/              # API clients and business logic
│   ├── geminiService.ts     # Hybrid search orchestrator + cache read/write
│   ├── rrApi.ts             # RadioReference SOAP client types
│   ├── supabaseClient.ts    # Supabase client initialization
│   ├── favoritesService.ts  # Saved locations CRUD
│   ├── crowdsourceService.ts# Frequency confirmations + leaderboard
│   ├── communityService.ts  # Forum posts, comments, upvotes, events CRUD
│   └── locationService.ts   # Local-only location normalization helpers
├── utils/                 # Exporters, security, PDF generation
│   ├── security.ts          # Input sanitization (OWASP LLM-01/02)
│   ├── csvGenerator.ts      # CSV export
│   ├── exportUtils.ts       # Sentinel paste export
│   ├── sentinelExporter.ts  # ZIP package for Uniden Sentinel
│   ├── sds100/              # SDS100 scaffold core (types/validation/renderer/builder)
│   ├── pdfGenerator.ts      # Trip PDF via jsPDF
│   └── manualGenerator.ts   # SDS100/200 programming manual generator
├── precacher/             # Oracle VM cache warmer + SEO publisher
│   ├── precacher.mjs        # Cache warmer + SEO publisher for the Oracle VM
│   ├── zipcodes.json        # List of popular US ZIPs to pre-cache
│   └── setup.sh             # Installs Node 20 + split systemd timers on Ubuntu VM
├── supabase/
│   └── crowdsource_schema.sql  # Table definitions and RLS policies
├── types.ts               # All shared TypeScript interfaces
├── App.tsx                # Main shell — state, auth, search, export orchestration
└── index.css              # Custom animations, theme variables, mobile styles
```

---

## Local Development

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project with Google OAuth enabled
- A [Google Gemini API key](https://aistudio.google.com)
- [Vercel CLI](https://vercel.com/docs/cli) (required for local serverless API routes)

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**

   Create a `.env.local` file in the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

   For RadioReference direct API (optional — enables ZIP lookups against RR database):
   ```env
   RR_APP_KEY=your_radioreference_app_key
   ```

   > RadioReference username/password are entered by the user in-app and stored in `sessionStorage` only — never persisted server-side.

3. **Start the dev server with API routes**
   ```bash
   vercel dev
   ```
   Or for frontend-only (no serverless API):
   ```bash
   npm run dev
   ```

4. **Run the smoke suite before deploys**
   ```bash
   npm run test:smoke
   ```
   Vercel production builds now run `npm run build:ci`, which executes the smoke suite before the production build.

---

## Environment Variables Reference

| Variable | Scope | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Server-side only | Google Gemini API key |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Supabase public anon key |
| `RR_APP_KEY` | Server-side only | RadioReference app key |

App search remains Gemini-powered in production. The Oracle precacher has its own separate environment and can run either Gemini or OpenRouter/Kimi.

---

## Supabase Schema

Tables are defined in `supabase/crowdsource_schema.sql`:

| Table | Purpose |
|-------|---------|
| `search_cache` | Cached AI+RR results keyed by canonical `v7_loc_*` geography keys with legacy `v6_loc_*` aliases still read for compatibility |
| `favorites` | User-saved locations (RLS-protected by `user_id`) |
| `profiles` | Display names, scanner model, bio, location, and avatar per user |
| `frequency_reports` | Crowdsourced "Heard It" confirmations and user frequency submissions |
| `user_stats` | Points, streaks, confirmation/submission counts for the leaderboard |
| `user_preferences` | Per-user default service type filter settings |
| `notifications` | In-app notification messages (badge unlocks, streak milestones) |
| `community_posts` | ScannerSphere forum posts with category, upvote count, and RLS policies |
| `post_upvotes` | One row per (post, user) pair; DB trigger keeps `community_posts.upvotes` in sync |
| `post_comments` | Threaded replies on community posts |
| `events` | Scanner-related events calendar entries (admin-managed) |

---

## Deployment

The app deploys to [Vercel](https://vercel.com). The `api/` folder is automatically converted to serverless functions.

1. Connect your GitHub repo to a Vercel project
2. Add all environment variables in the Vercel project settings
3. Push to GitHub to deploy — `vercel.json` is included with the correct framework config
4. Vercel production builds run `npm run build:ci`, which runs the smoke suite before building

---

## Pre-cacher (Oracle Cloud VM)

The `precacher/` folder contains a standalone Node.js script that does two jobs:

- **Cache warmer** — refreshes high-value ZIP searches into Supabase so users get faster cached responses
- **SEO publisher** — renders ZIP landing pages from cached entries and pushes them to the SEO repo

Current cache-warming strategy:

- **Hot ZIPs** — ZIPs discovered from recent searches, user favorites, and community frequency activity
- **Warm ZIPs** — seed coverage ZIPs from `precacher/zipcodes.json`
- **Different refresh windows** — hot ZIPs refresh more aggressively than warm ZIPs
- **Seed expansion over time** — hot ZIPs can be appended back into `precacher/zipcodes.json` so weekly runs steadily broaden coverage from real demand
- **Optional RR assist for hot ZIPs** — bounded weekly refreshes can call the app's `/api/rrdb` endpoint for high-value ZIPs only when RR credentials are configured on the Oracle VM
- **ZIP-only SEO pages** — the SEO publisher generates pages only from ZIP cache entries, regardless of whether they were reached through canonical v7 keys or legacy ZIP aliases
- **Independent execution** — cache warming and SEO publishing run on separate timers so one can succeed without the other

Search behavior notes:

- Text searches now resolve to a canonical location before cache lookup, which lets `84770`, `St. George, UT`, and `Washington County, UT` converge on the same cached geography when they refer to the same area
- If a text query resolves to a primary ZIP and the user has RadioReference credentials, the app can use that ZIP for a verified RR lookup instead of falling back to AI-only coverage
- The app surfaces interpreted-scope guidance and quick refinement chips so users can explicitly rerun the search as ZIP, city, or county when a broad query could reasonably map to multiple scopes

- **Script:** `precacher/precacher.mjs`
- **Schedule:** Cache timer Monday at 8:00 AM UTC, SEO timer Monday at 8:30 AM UTC by default (configurable via `CACHE_ON_CALENDAR` / `SEO_ON_CALENDAR` in `precacher/.env`)
- **ZIP list:** `precacher/zipcodes.json`

To deploy/update the precacher:
```bash
scp precacher/precacher.mjs oracle:~/boy-and-a-scanner-app/precacher/
ssh oracle "cd ~/boy-and-a-scanner-app/precacher && node precacher.mjs"
```

Manual modes:
```bash
ssh oracle "cd ~/boy-and-a-scanner-app/precacher && node precacher.mjs --cache-only"
ssh oracle "cd ~/boy-and-a-scanner-app/precacher && node precacher.mjs --seo-only"
ssh oracle "cd ~/boy-and-a-scanner-app/precacher && node precacher.mjs --test"
```

The precacher needs its own `.env` containing an AI provider key plus `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

AI provider options for the precacher:

- **Gemini** — set `AI_PROVIDER=gemini` and `GEMINI_API_KEY=...`
- **OpenRouter / Kimi** — set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY=...`, and `AI_MODEL=moonshotai/kimi-k2` (or another supported Kimi model id)

Optional RR-assisted weekly refresh for hot ZIPs:

- Set `RR_REFRESH_ENABLED=1`
- Set `APP_BASE_URL=https://app.boyandascanner.com`
- Set `RR_USERNAME` / `RR_PASSWORD` on the Oracle VM only
- Leave `RR_REFRESH_HOT_ONLY=1` to keep the RR pass bounded to hot-demand ZIPs

Important precacher env vars:

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | `gemini` or `openrouter` |
| `AI_MODEL` | Model id used by the selected AI provider |
| `GEMINI_API_KEY` | Gemini API key used when `AI_PROVIDER=gemini` |
| `OPENROUTER_API_KEY` | OpenRouter API key used when `AI_PROVIDER=openrouter` |
| `OPENROUTER_SITE_URL` | Referer sent to OpenRouter for attribution and rate-limit friendliness |
| `OPENROUTER_APP_NAME` | App title sent to OpenRouter in the `X-Title` header |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key for cache read/write |
| `APP_BASE_URL` | Deployed app URL used for bounded `/api/rrdb` refreshes |
| `DELAY_SECONDS` | Delay between Gemini requests |
| `MAX_AGE_HOURS` | Legacy fallback if `HOT_MAX_AGE_HOURS` is not set |
| `HOT_MAX_AGE_HOURS` | Refresh window for high-value ZIPs |
| `WARM_MAX_AGE_HOURS` | Refresh window for seed ZIPs |
| `MAX_SEED_ZIPS` | Max seed ZIPs included in each run |
| `MAX_RECENT_SEARCH_ZIPS` | Max recent searched ZIPs included in each run |
| `MAX_FAVORITE_ZIPS` | Max favorite ZIPs included in each run |
| `MAX_REPORT_ZIPS` | Max ZIPs pulled from community activity |
| `EXPAND_SEED_ZIPS` | Persist newly hot ZIPs back into the seed file |
| `MAX_SEED_APPEND_PER_RUN` | Cap how many newly hot ZIPs can be appended into the seed file per run |
| `RR_REFRESH_ENABLED` | Enable bounded RR refreshes during weekly cache runs |
| `RR_REFRESH_HOT_ONLY` | Limit RR refreshes to hot ZIPs only |
| `RR_USERNAME` / `RR_PASSWORD` | RR credentials used only by the Oracle worker |
| `CACHE_ON_CALENDAR` | systemd `OnCalendar` schedule for weekly cache runs |
| `SEO_ON_CALENDAR` | systemd `OnCalendar` schedule for weekly SEO runs |
| `GITHUB_TOKEN` | GitHub PAT used for SEO repo publishing |
| `GITHUB_REPO` | SEO repo target such as `user/repo` |
| `SEO_SITE_URL` | Canonical site URL used in generated SEO pages |

Operational notes:

- Cache runs now report ZIP plan composition and hot/warm cache results directly in the logs
- SEO runs report how many ZIP entries were used as input and how many pages were published
- The legacy combined `precacher.timer` is replaced by `precacher-cache.timer` and `precacher-seo.timer`

---

## Links

- **App:** [boyandascanner.com](https://boyandascanner.com)
- **Frequency Directory:** [scanner-seo-pages.vercel.app/frequencies](https://scanner-seo-pages.vercel.app/frequencies)
- **Merch Store:** [shop.boyandascanner.com](https://shop.boyandascanner.com)
- **Support the project:** [buymeacoffee.com/boyandascanner](https://buymeacoffee.com/boyandascanner)
- **Feature requests:** contact@boyandascanner.com

---

> *For hobby and educational use only. Always comply with local laws regarding radio monitoring. Do not transmit on public safety frequencies.*

---

## Changelog

### March 22, 2026 — Precacher Overhaul
- Fixed the Oracle worker bug where the Gemini client was never initialized (`ai is not defined`)
- Reworked cache warming to prioritize recent searches, favorites, and community activity over blanket stale refreshes
- Added separate `--cache-only` and `--seo-only` execution modes to `precacher.mjs`
- Split Oracle systemd scheduling into `precacher-cache.timer` and `precacher-seo.timer`
- Restricted SEO generation to ZIP cache entries only so the SEO directory mirrors the intended ZIP landing page strategy
- Added per-run reporting for ZIP plan composition and hot/warm cache outcomes

### March 20, 2026 — ScannerSphere Community Hub
- Added **COMMUNITY** mode (5th nav tab) — lazy-loaded, available on desktop nav, mobile hamburger, and mobile bottom tab bar
- **Forum** — categorized discussion threads (Equipment, Frequencies, Events, Legal & Ethics, General) with upvoting and threaded comments; full RLS policies; rate-limit-safe DB trigger for upvote counts
- **Events Calendar** — upcoming scanner events pulled from new `events` Supabase table; past events auto-hidden
- **Tips & Tutorials** — 5 curated static sections (always available, no DB dependency)
- New Supabase tables: `community_posts`, `post_upvotes`, `post_comments`, `events`
- DB trigger `handle_post_upvote_change` keeps `community_posts.upvotes` consistent on insert/delete without a custom RPC
- New `services/communityService.ts` with full CRUD for posts, comments, upvotes, and events; input sanitised (angle brackets stripped, lengths capped in both service layer and DB CHECK constraints)
- Expanded `profiles` table with `bio`, `location_display`, `frequency_interests` columns
- `ProfileModal` updated with Bio (280 chars) and Location optional fields
- Added SEO meta tags (`description`, Open Graph, Twitter Card) to `index.html`
- All 6 smoke tests continue to pass; 0 TypeScript errors
