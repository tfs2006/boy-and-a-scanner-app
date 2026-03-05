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

### 4 App Modes
| Mode | Description |
|------|-------------|
| **LOCAL** | Search a single location by ZIP, city name, or current GPS coordinates |
| **TRIP** | Enter origin + destination — AI maps 3–5 scan zones along your route |
| **EXPLORE** | Interactive US map of all cloud-cached locations; tap any marker to browse frequencies instantly |
| **RANKS** | Community leaderboard — earn points by confirming active frequencies with "Heard It" |

### Hybrid Data Sources
- **RadioReference SOAP API** — Authoritative verified data for ZIP code lookups (requires RR Premium account)
- **Google Gemini 2.0 Flash AI** — Grounded AI search for city, county, and GPS coordinate queries
- **Cloud Cache** — Supabase-backed cache; repeat searches return instantly without a new AI call

### Export Ecosystem
| Export | Description |
|--------|-------------|
| CSV | Spreadsheet-compatible frequency list |
| Copy for Sentinel | Tab-delimited clipboard copy for paste into Uniden Sentinel |
| Programming Manual | Printable step-by-step SDS100/SDS200 programming guide |
| Trip PDF | Formatted trip manifest with zone-by-zone frequencies |
| SDS100 ZIP | Full Sentinel package with CSVs and guides |

### Other Features
- **Saved Locations** — Star searches to personal favorites (synced via Supabase)
- **System Type Filter** — Filter results by Analog, P25 Phase I/II, DMR, NXDN, EDACS, LTR, Motorola
- **Service Filter** — 18 service categories (Police, Fire, EMS, Ham, Railroad, Air, Marine, Military, and more)
- **Comparison View** — Pin one location to compare side-by-side with a second search
- **Crowdsource** — Submit field-confirmed frequencies; earn points on the leaderboard
- **Dark / Light theme toggle**
- **Advanced Search** — Filter by State, City, County, or ZIP with structured form fields

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons |
| Auth | Supabase (Google OAuth) |
| Database | Supabase (PostgreSQL) — cache, favorites, crowdsource logs |
| AI | Google Gemini 2.0 Flash (`@google/genai`) |
| External API | RadioReference SOAP API (premium subscription required) |
| Maps | Leaflet + react-leaflet (CartoDB dark / OpenStreetMap tiles) |
| Export | jsPDF, jszip, custom CSV and Sentinel formatters |
| Deployment | Vercel — frontend + serverless API functions |
| Pre-cacher | Oracle Cloud Free Tier Ubuntu VM (Node.js, daily cron) |

---

## Project Structure

```
├── api/                   # Vercel serverless functions
│   ├── search.ts            # POST /api/search  — Gemini AI frequency search
│   ├── rrdb.ts              # POST /api/rrdb    — RadioReference SOAP wrapper
│   └── trip.ts              # POST /api/trip    — Gemini trip planner
├── components/            # React UI components
│   ├── Auth.tsx             # Google OAuth login page
│   ├── SearchForm.tsx       # Simple + advanced location search input
│   ├── FrequencyDisplay.tsx # Agency cards + trunked system tables
│   ├── TripPlanner.tsx      # Route planner UI and results
│   ├── ExploreMap.tsx       # Interactive Leaflet cache map
│   ├── Leaderboard.tsx      # Community rankings + personal stats
│   ├── ComparisonView.tsx   # Side-by-side location comparison
│   ├── ProgrammingManual.tsx# Printable SDS100/200 manual modal
│   └── ...
├── services/              # API clients and business logic
│   ├── geminiService.ts     # Hybrid search orchestrator + cache read/write
│   ├── rrApi.ts             # RadioReference SOAP client types
│   ├── supabaseClient.ts    # Supabase client initialization
│   ├── favoritesService.ts  # Saved locations CRUD
│   ├── crowdsourceService.ts# Frequency confirmations + leaderboard
│   └── locationService.ts   # Reverse geocoding helpers
├── utils/                 # Exporters, security, PDF generation
│   ├── security.ts          # Input sanitization (OWASP LLM-01/02)
│   ├── csvGenerator.ts      # CSV export
│   ├── exportUtils.ts       # Sentinel paste export
│   ├── sentinelExporter.ts  # ZIP package for Uniden Sentinel
│   ├── pdfGenerator.ts      # Trip PDF via jsPDF
│   └── manualGenerator.ts   # SDS100/200 programming manual generator
├── precacher/             # Oracle VM pre-cache script
│   ├── precacher.mjs        # Daily cron — populates cache for popular ZIPs
│   ├── zipcodes.json        # List of popular US ZIPs to pre-cache
│   └── setup.sh             # Installs Node 20 + systemd timer on Ubuntu VM
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

   > RadioReference username/password are entered by the user in-app and stored in `localStorage` only — never persisted server-side.

3. **Start the dev server with API routes**
   ```bash
   vercel dev
   ```
   Or for frontend-only (no serverless API):
   ```bash
   npm run dev
   ```

---

## Environment Variables Reference

| Variable | Scope | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Server-side only | Google Gemini API key |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Supabase public anon key |
| `RR_APP_KEY` | Server-side only | RadioReference app key |

---

## Supabase Schema

Tables are defined in `supabase/crowdsource_schema.sql`:

| Table | Purpose |
|-------|---------|
| `search_cache` | Cached results keyed by `v6_loc_{sanitized_location}` |
| `favorites` | User-saved locations (RLS-protected by `user_id`) |
| `frequency_confirmations` | Crowdsourced "Heard It" confirmation logs |
| `auth.users` | Built-in Supabase Google OAuth users |

---

## Deployment

The app deploys to [Vercel](https://vercel.com). The `api/` folder is automatically converted to serverless functions.

1. Connect your GitHub repo to a Vercel project
2. Add all environment variables in the Vercel project settings
3. Push to deploy — `vercel.json` is included with the correct framework config

---

## Pre-cacher (Oracle Cloud VM)

The `precacher/` folder contains a standalone Node.js script that pre-populates the Supabase cache with results for popular US ZIP codes so users get instant cached responses.

- **Script:** `precacher/precacher.mjs`
- **Schedule:** Daily at 3 AM UTC via systemd timer (configured by `precacher/setup.sh`)
- **ZIP list:** `precacher/zipcodes.json`

To deploy/update the precacher:
```bash
scp precacher/precacher.mjs oracle:~/boy-and-a-scanner-app/precacher/
ssh oracle "cd ~/boy-and-a-scanner-app/precacher && node precacher.mjs"
```

The precacher needs its own `.env` containing `GEMINI_API_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.

---

## Links

- **App:** [boyandascanner.com](https://boyandascanner.com)
- **Frequency Directory:** [scanner-seo-pages.vercel.app/frequencies](https://scanner-seo-pages.vercel.app/frequencies)
- **Merch Store:** [shop.boyandascanner.com](https://shop.boyandascanner.com)
- **Support the project:** [buymeacoffee.com/boyandascanner](https://buymeacoffee.com/boyandascanner)
- **Feature requests:** contact@boyandascanner.com

---

> *For hobby and educational use only. Always comply with local laws regarding radio monitoring. Do not transmit on public safety frequencies.*
