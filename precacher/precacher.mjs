#!/usr/bin/env node
/**
 * Boy & A Scanner — Pre-Cacher + SEO Generator Service
 *
 * Runs on cron (systemd timer) daily. Two phases:
 *   Phase 1 — Pre-cache: Fetch frequency data from Gemini for stale/missing ZIPs → Supabase
 *   Phase 2 — SEO:       Read all cached entries → render static HTML pages → git push to GitHub
 *
 * Usage:
 *   node precacher.mjs            # Full run (both phases)
 *   node precacher.mjs --test     # Test mode (3 ZIPs, SEO skipped)
 *   node precacher.mjs --seo-only # Skip Phase 1, run SEO generation only
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZIPCODES = JSON.parse(readFileSync(join(__dirname, 'zipcodes.json'), 'utf-8'));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DELAY_MS = (parseInt(process.env.DELAY_SECONDS) || 5) * 1000;
const MAX_AGE_MS = (parseInt(process.env.MAX_AGE_HOURS) || 24) * 60 * 60 * 1000;
const MODEL_NAME = 'gemini-2.0-flash';
const SERVICE_TYPES = [
    'Police', 'Fire', 'EMS', 'Ham Radio', 'Railroad', 'Air', 'Marine',
    'Federal', 'Military', 'Public Works', 'Utilities', 'Transportation',
    'Business', 'Hospitals', 'Schools', 'Corrections', 'Security', 'Multi-Dispatch'
];

// SEO config
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;           // personal access token (repo scope)
const GITHUB_REPO = process.env.GITHUB_REPO;             // e.g. "youruser/scanner-seo-pages"
const SEO_SITE_URL = process.env.SEO_SITE_URL || 'https://www.boyandascanner.com'; // canonical app URL
const SEO_BUILD_DIR = join(__dirname, '.seo-build');    // temp dir, cleaned each run

const IS_TEST = process.argv.includes('--test');
const IS_SEO_ONLY = process.argv.includes('--seo-only');

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing env vars. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Dynamic ZIP Discovery ──────────────────────────────────────────────────

/**
 * Pulls every ZIP code that users have ever searched from the search_cache table.
 * Keys are stored as "v6_loc_XXXXX" — we extract the 5-digit ZIP from each.
 */
async function getSearchedZips() {
    try {
        // Fetch all keys that look like a ZIP-based search (v6_loc_#####)
        const { data, error } = await supabase
            .from('search_cache')
            .select('search_key')
            .like('search_key', 'v6_loc_%');

        if (error || !data) return [];

        const zips = [];
        for (const row of data) {
            // Extract the part after 'v6_loc_'
            const suffix = row.search_key.replace(/^v6_loc_/, '');
            // Only keep pure 5-digit ZIP codes (ignore city,state searches)
            if (/^\d{5}$/.test(suffix)) {
                zips.push(suffix);
            }
        }
        return zips;
    } catch (e) {
        console.warn('⚠️  Could not fetch searched ZIPs from Supabase:', e.message);
        return [];
    }
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function makeCacheKey(zip) {
    return `v6_loc_${zip}`;
}

async function isFresh(cacheKey) {
    try {
        const { data, error } = await supabase
            .from('search_cache')
            .select('updated_at')
            .eq('search_key', cacheKey)
            .single();

        if (error || !data || !data.updated_at) return false;

        const age = Date.now() - new Date(data.updated_at).getTime();
        return age < MAX_AGE_MS;
    } catch {
        return false;
    }
}

async function saveToCache(cacheKey, resultData, groundingChunks) {
    const { error } = await supabase.from('search_cache').upsert({
        search_key: cacheKey,
        result_data: resultData,
        grounding_chunks: groundingChunks || null,
    }, { onConflict: 'search_key' });

    if (error) {
        console.error(`   └─ Cache write error: ${error.message}`);
        return false;
    }
    return true;
}

// ─── Gemini Prompt (mirrors api/search.ts) ────────────────────────────────────

function buildPrompt(zip) {
    return `
    You are an intelligent interface for the RadioReference Database.
    Task: Retrieve the official radio frequency data for Location: "${zip}".
    IMPORTANT: Since this is a ZIP CODE, first identify the County and State.
    
    SCOPE: ${SERVICE_TYPES.join(', ')}.
    
    CRITICAL INCLUSION RULES:
    1. **Statewide/Regional Systems**: Include large trunked systems (e.g. UCA, AIRS, RISCON) if they cover the area.
    2. **Synonyms**: "Police" includes Sheriff, Highway Patrol. "Fire" includes Rescue.
    3. **Conventional**: Include analog frequencies.
    
    DATA EXTRACTION:
    1. **Trunked System Sites**: Identify specific sites/towers for "${zip}".
    2. **Control Channels**: Extract "Freqs" (Control Channels) for that site.
    3. **Tone/NAC**: Capture PL/DPL/NAC.
    
    OUTPUT FORMAT:
    Return strictly formatted JSON inside a code block.
    \`\`\`json
    {
      "source": "AI",
      "locationName": "County, State",
      "coords": { "lat": 0.0, "lng": 0.0 },
      "summary": "Overview...",
      "crossRef": { "verified": true, "confidenceScore": 95, "sourcesChecked": 3, "notes": "Verified." },
      "agencies": [
        {
          "name": "Agency Name",
          "category": "Police",
          "frequencies": [ { "freq": "155.000", "description": "Dispatch", "mode": "FMN", "tag": "Dispatch", "alphaTag": "PD", "tone": "123.4", "nac": "293" } ]
        }
      ],
      "trunkedSystems": [
        {
          "name": "System Name",
          "type": "P25",
          "location": "Site Name",
          "frequencies": [ { "freq": "851.000", "use": "Control" } ],
          "talkgroups": [ { "dec": "123", "mode": "D", "alphaTag": "DISP", "description": "Dispatch", "tag": "Law Dispatch" } ]
        }
      ]
    }
    \`\`\`
  `;
}

// ─── Gemini Call + Parse ──────────────────────────────────────────────────────

async function fetchFromGemini(zip) {
    const prompt = buildPrompt(zip);
    let response;
    let usedTools = true;

    try {
        response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
        });
    } catch (err) {
        const msg = err.message || JSON.stringify(err);
        if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
            console.warn(`   └─ Google Search Tool rejected, retrying without tools...`);
            usedTools = false;
            response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: prompt,
            });
        } else {
            throw err;
        }
    }

    const text = response?.text || '{}';
    let data = null;

    // Robust JSON parsing (same as api/search.ts)
    try {
        const match = text.match(/```json\n([\s\S]*?)(\n```|$)/);
        if (match && match[1]) {
            data = JSON.parse(match[1]);
        } else {
            data = JSON.parse(text);
        }
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            try { data = JSON.parse(text.substring(start, end + 1)); } catch { }
        }
    }

    if (data) {
        data.source = 'AI';
        if (!Array.isArray(data.agencies)) data.agencies = [];
        if (!Array.isArray(data.trunkedSystems)) data.trunkedSystems = [];
        data.agencies.forEach(a => { if (!Array.isArray(a.frequencies)) a.frequencies = []; });
        data.trunkedSystems.forEach(s => {
            if (!Array.isArray(s.talkgroups)) s.talkgroups = [];
            if (!Array.isArray(s.frequencies)) s.frequencies = [];
        });
    }

    const groundingChunks = usedTools
        ? (response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
        : [];

    return { data, groundingChunks };
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function run() {
    const startTime = Date.now();

    // Build ZIP list: static seed + ZIPs users have actually searched
    let zips;
    if (IS_TEST) {
        zips = ZIPCODES.slice(0, 3);
    } else {
        console.log('  Discovering searched ZIPs from Supabase...');
        const searchedZips = await getSearchedZips();
        const combined = [...new Set([...ZIPCODES, ...searchedZips])];
        const newlyDiscovered = searchedZips.filter(z => !ZIPCODES.includes(z));
        console.log(`  Static seed: ${ZIPCODES.length} ZIPs`);
        console.log(`  User-searched: ${searchedZips.length} ZIPs (${newlyDiscovered.length} new beyond seed)`);
        zips = combined;
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  BOY & A SCANNER — PRE-CACHER + SEO GENERATOR');
    console.log(`  Mode: ${IS_SEO_ONLY ? 'SEO ONLY' : IS_TEST ? 'TEST (3 ZIPs, SEO skipped)' : `FULL (${zips.length} ZIPs + SEO)`}`);
    if (!IS_SEO_ONLY) {
        console.log(`  Delay: ${DELAY_MS / 1000}s between calls`);
        console.log(`  Max age: ${MAX_AGE_MS / 3600000}h`);
    }
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');

    // ── Phase 1: Pre-Cache ──────────────────────────────────────────────────

    let cached = 0;
    let skipped = 0;
    let failed = 0;

    if (!IS_SEO_ONLY) {
        console.log('');
        console.log('  PHASE 1 — PRE-CACHE');
        console.log('───────────────────────────────────────────────────────────');

        for (let i = 0; i < zips.length; i++) {
            const zip = zips[i];
            const cacheKey = makeCacheKey(zip);
            const progress = `[${i + 1}/${zips.length}]`;

            // Check if already fresh
            const fresh = await isFresh(cacheKey);
            if (fresh) {
                console.log(`${progress} ${zip} — SKIP (already fresh)`);
                skipped++;
                continue;
            }

            console.log(`${progress} ${zip} — fetching from Gemini...`);

            try {
                const { data, groundingChunks } = await fetchFromGemini(zip);

                if (data && (data.agencies?.length > 0 || data.trunkedSystems?.length > 0)) {
                    const ok = await saveToCache(cacheKey, data, groundingChunks);
                    if (ok) {
                        const agencyCount = data.agencies?.length || 0;
                        const trsCount = data.trunkedSystems?.length || 0;
                        console.log(`   └─ ✅ Cached: ${data.locationName || zip} (${agencyCount} agencies, ${trsCount} trunked)`);
                        cached++;
                    } else {
                        failed++;
                    }
                } else {
                    console.log(`   └─ ⚠️  No data returned for ${zip}`);
                    failed++;
                }
            } catch (err) {
                console.error(`   └─ ❌ Error: ${err.message}`);
                failed++;

                // If rate limited, wait longer
                if (err.message?.includes('429') || err.message?.includes('RATE')) {
                    console.log('   └─ Rate limited! Waiting 60s...');
                    await sleep(60000);
                }
            }

            // Delay between calls
            if (i < zips.length - 1) {
                await sleep(DELAY_MS);
            }
        }

        const elapsed1 = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('');
        console.log('  PHASE 1 RESULTS');
        console.log(`  ✅ Cached:  ${cached}`);
        console.log(`  ⏭️  Skipped: ${skipped}`);
        console.log(`  ❌ Failed:  ${failed}`);
        console.log(`  ⏱️  Elapsed: ${elapsed1}s`);
    }

    // ── Phase 2: SEO Page Generation ───────────────────────────────────────

    if (!IS_TEST) {
        console.log('');
        console.log('  PHASE 2 — SEO PAGE GENERATION');
        console.log('───────────────────────────────────────────────────────────');
        console.log('  ▸ Reading all cached entries from Supabase...');

        const entries = await fetchAllCachedEntries();
        console.log(`  ▸ Found ${entries.length} cached entries`);

        if (entries.length > 0) {
            const seoResult = await pushSeoPages(entries);
            if (seoResult.skipped) {
                console.log('  ⏭️  SEO push skipped (no GitHub credentials configured)');
            } else if (seoResult.unchanged) {
                console.log('  ⏭️  SEO pages unchanged — nothing to push');
            } else {
                console.log(`  ✅ SEO: ${seoResult.pushed} pages published`);
            }
        } else {
            console.log('  ⚠️  No cached entries found — nothing to generate');
        }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DONE');
    console.log(`  ⏱️  Total elapsed: ${totalElapsed}s`);
    console.log(`  Finished: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SEO: Read All Cache Entries ──────────────────────────────────────────────

async function fetchAllCachedEntries() {
    const PAGE_SIZE = 1000;
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('search_cache')
            .select('search_key, result_data, updated_at')
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error(`   └─ Supabase read error: ${error.message}`);
            break;
        }
        if (!data || data.length === 0) break;

        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return allRows;
}

// ─── SEO: HTML Template ───────────────────────────────────────────────────────

function renderSeoPage(zip, entry) {
    const data = entry.result_data;
    const locationName = data?.locationName || zip;
    const summary = data?.summary || '';
    const agencies = Array.isArray(data?.agencies) ? data.agencies : [];
    const trunked = Array.isArray(data?.trunkedSystems) ? data.trunkedSystems : [];
    const updatedAt = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const appUrl = `${SEO_SITE_URL}/?q=${encodeURIComponent(zip)}`;

    const escapeHtml = (str) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Build conventional agencies section
    const agencyRows = agencies.flatMap(agency =>
        (agency.frequencies || []).map(f => `
        <tr>
          <td>${escapeHtml(agency.name)}</td>
          <td>${escapeHtml(agency.category)}</td>
          <td>${escapeHtml(f.freq)} MHz</td>
          <td>${escapeHtml(f.mode)}</td>
          <td>${escapeHtml(f.alphaTag || f.description)}</td>
          <td>${escapeHtml(f.tone || '—')}</td>
        </tr>`)
    ).join('');

    const agenciesSection = agencies.length > 0 ? `
    <section class="section">
      <h2>Conventional Frequencies</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agency</th><th>Category</th><th>Frequency</th><th>Mode</th><th>Channel</th><th>Tone/NAC</th></tr></thead>
          <tbody>${agencyRows}</tbody>
        </table>
      </div>
    </section>` : '';

    // Build trunked systems section
    const trunkedSections = trunked.map(sys => {
        const ctrlFreqs = (sys.frequencies || []).map(f =>
            `<span class="freq-badge">${escapeHtml(f.freq)} MHz${f.use ? ` <em>(${escapeHtml(f.use)})</em>` : ''}</span>`
        ).join(' ');

        const tgRows = (sys.talkgroups || []).map(tg => `
        <tr>
          <td>${escapeHtml(tg.dec)}</td>
          <td>${escapeHtml(tg.mode)}</td>
          <td>${escapeHtml(tg.alphaTag)}</td>
          <td>${escapeHtml(tg.tag)}</td>
          <td>${escapeHtml(tg.description)}</td>
        </tr>`).join('');

        return `
    <section class="section">
      <h2>${escapeHtml(sys.name)} <span class="badge">${escapeHtml(sys.type)}</span></h2>
      ${sys.location ? `<p class="sys-location">Site: ${escapeHtml(sys.location)}</p>` : ''}
      ${ctrlFreqs ? `<p class="ctrl-label">Control Channels:</p><div class="ctrl-freqs">${ctrlFreqs}</div>` : ''}
      ${tgRows ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>DEC</th><th>Mode</th><th>Alpha Tag</th><th>Service</th><th>Description</th></tr></thead>
          <tbody>${tgRows}</tbody>
        </table>
      </div>` : ''}
    </section>`;
    }).join('');

    const totalFreqs = agencies.reduce((n, a) => n + (a.frequencies?.length || 0), 0);
    const totalTGs = trunked.reduce((n, s) => n + (s.talkgroups?.length || 0), 0);

    const metaDesc = escapeHtml(
        summary ||
        `Scanner frequencies for ${locationName} — ${totalFreqs} conventional frequencies, ${trunked.length} trunked systems. Police, Fire, EMS radio channels.`
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scanner Frequencies for ${escapeHtml(locationName)} (${zip}) — Boy &amp; A Scanner</title>
  <meta name="description" content="${metaDesc}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SEO_SITE_URL}/frequencies/${zip}">
  <meta property="og:title" content="Scanner Frequencies for ${escapeHtml(locationName)}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:url" content="${SEO_SITE_URL}/frequencies/${zip}">
  <meta property="og:type" content="website">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }
    header h1 { font-size: 1.1rem; color: #f1f5f9; }
    header .logo { font-weight: 700; font-size: 1.2rem; color: #38bdf8; }
    .hero { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 2.5rem 1.5rem; border-bottom: 1px solid #334155; }
    .hero h2 { font-size: 1.75rem; color: #f1f5f9; margin-bottom: 0.5rem; }
    .hero .sub { color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem; }
    .stats { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
    .stat { background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem; padding: 0.6rem 1rem; font-size: 0.85rem; color: #cbd5e1; }
    .stat strong { color: #38bdf8; }
    .cta { display: inline-block; background: #0ea5e9; color: #fff; font-weight: 600; padding: 0.65rem 1.4rem; border-radius: 0.5rem; font-size: 0.95rem; }
    .cta:hover { background: #38bdf8; text-decoration: none; }
    .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    .section { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.1rem; color: #f1f5f9; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
    .badge { font-size: 0.7rem; background: #0369a1; color: #bae6fd; padding: 0.2rem 0.5rem; border-radius: 0.25rem; font-weight: 600; text-transform: uppercase; }
    .sys-location { font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.5rem; }
    .ctrl-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.35rem; }
    .ctrl-freqs { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.75rem; }
    .freq-badge { background: #0f172a; border: 1px solid #334155; border-radius: 0.35rem; padding: 0.25rem 0.6rem; font-size: 0.8rem; color: #7dd3fc; font-family: monospace; }
    .freq-badge em { color: #64748b; font-style: normal; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { background: #0f172a; color: #94a3b8; text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #334155; white-space: nowrap; }
    td { padding: 0.45rem 0.75rem; border-bottom: 1px solid #1e293b; color: #cbd5e1; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.03); }
    .updated { font-size: 0.78rem; color: #475569; margin-top: 0.5rem; }
    footer { background: #1e293b; border-top: 1px solid #334155; padding: 1.5rem; text-align: center; color: #475569; font-size: 0.85rem; }
    footer a { color: #64748b; }
    .breadcrumb { background: #0f172a; border-bottom: 1px solid #1e293b; padding: 0.5rem 1.5rem; font-size: 0.8rem; color: #475569; display: flex; align-items: center; gap: 0.5rem; }
    .breadcrumb a { color: #64748b; }
    .breadcrumb a:hover { color: #38bdf8; }
    @media (max-width: 600px) {
      .hero h2 { font-size: 1.3rem; }
      th, td { padding: 0.4rem 0.5rem; }
    }
  </style>
</head>
<body>
  <header>
    <span class="logo">Boy &amp; A Scanner</span>
    <h1>Scanner Frequencies — ${escapeHtml(locationName)}</h1>
    <a class="cta" href="${appUrl}">Open in App →</a>
  </header>
  <nav class="breadcrumb">
    <a href="${SEO_SITE_URL}/frequencies">← All Locations</a>
    <span>/</span>
    <span>${escapeHtml(locationName)} (${zip})</span>
  </nav>

  <div class="hero">
    <div class="container">
      <h2>Radio Frequencies for ${escapeHtml(locationName)} (${zip})</h2>
      ${summary ? `<p class="sub">${escapeHtml(summary)}</p>` : ''}
      <div class="stats">
        <div class="stat"><strong>${agencies.length}</strong> agencies</div>
        <div class="stat"><strong>${totalFreqs}</strong> conventional frequencies</div>
        <div class="stat"><strong>${trunked.length}</strong> trunked systems</div>
        <div class="stat"><strong>${totalTGs}</strong> talkgroups</div>
      </div>
      <a class="cta" href="${appUrl}">Search ${escapeHtml(locationName)} in the App →</a>
      ${updatedAt ? `<p class="updated">Data last updated: ${updatedAt}</p>` : ''}
    </div>
  </div>

  <div class="container">
    ${agenciesSection}
    ${trunkedSections}

    <section class="section">
      <h2>Program Your Scanner</h2>
      <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:1rem;">
        Use the full interactive app to get step-by-step Uniden SDS100/SDS200 programming instructions,
        export CSV files for Sentinel, and compare locations side by side.
      </p>
      <a class="cta" href="${appUrl}">Open ${escapeHtml(locationName)} in Boy &amp; A Scanner →</a>
    </section>
  </div>

  <footer>
    <p>Data sourced from RadioReference via AI grounding. For best accuracy, use the
    <a href="${SEO_SITE_URL}">Boy &amp; A Scanner app</a> with a RadioReference premium account.</p>
    <p style="margin-top:0.5rem;">© ${new Date().getFullYear()} Boy &amp; A Scanner</p>
  </footer>
</body>
</html>`;
}

// ─── SEO: Index Page ──────────────────────────────────────────────────────────

function renderIndexPage(entries) {
    const escapeHtml = (str) => String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const locationCards = entries
        .filter(e => e.result_data?.locationName)
        .sort((a, b) => (a.result_data.locationName || '').localeCompare(b.result_data.locationName || ''))
        .map(e => {
            const zip = e.search_key.replace(/^.*loc_/, '').replace(/_\[.*\]$/, '');
            const name = e.result_data.locationName;
            const agencyCount = e.result_data.agencies?.length || 0;
            const trsCount = e.result_data.trunkedSystems?.length || 0;
            return `<a class="card" href="/frequencies/${zip}">
          <span class="card-name">${escapeHtml(name)}</span>
          <span class="card-zip">${zip}</span>
          <span class="card-meta">${agencyCount} agencies · ${trsCount} trunked</span>
        </a>`;
        }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>US Scanner Frequency Directory — Boy &amp; A Scanner</title>
  <meta name="description" content="Browse police, fire, and EMS scanner frequencies for hundreds of US locations. Find trunked systems, control channels, and talkgroups for your area.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${SEO_SITE_URL}/frequencies">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    a { color: #38bdf8; text-decoration: none; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-weight: 700; color: #38bdf8; font-size: 1.2rem; }
    .cta { background: #0ea5e9; color: #fff; font-weight: 600; padding: 0.5rem 1.2rem; border-radius: 0.5rem; font-size: 0.9rem; }
    .cta:hover { background: #38bdf8; }
    .hero { padding: 3rem 1.5rem 2rem; text-align: center; border-bottom: 1px solid #334155; }
    .hero h1 { font-size: 2rem; color: #f1f5f9; margin-bottom: 0.5rem; }
    .hero p { color: #94a3b8; max-width: 540px; margin: 0 auto 1.5rem; }
    .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 0.6rem; padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; transition: border-color 0.15s; }
    .card:hover { border-color: #38bdf8; text-decoration: none; }
    .card-name { font-weight: 600; color: #f1f5f9; font-size: 0.9rem; }
    .card-zip { font-size: 0.8rem; color: #64748b; font-family: monospace; }
    .card-meta { font-size: 0.78rem; color: #475569; margin-top: 0.15rem; }
    footer { text-align: center; padding: 2rem; color: #475569; font-size: 0.85rem; border-top: 1px solid #1e293b; }
    footer a { color: #64748b; }
  </style>
</head>
<body>
  <header>
    <span class="logo">Boy &amp; A Scanner</span>
    <a class="cta" href="${SEO_SITE_URL}">Open App →</a>
  </header>
  <div class="hero">
    <h1>US Scanner Frequency Directory</h1>
    <p>Browse police, fire, and EMS radio frequencies for hundreds of US locations. Click any location for full frequency details and scanner programming guides.</p>
    <a class="cta" href="${SEO_SITE_URL}">Search Any Location →</a>
  </div>
  <div class="container">
    <p style="color:#64748b;font-size:0.85rem;margin-bottom:1.25rem;">${entries.length} locations indexed</p>
    <div class="grid">${locationCards}</div>
  </div>
  <footer>
    <p><a href="${SEO_SITE_URL}">Boy &amp; A Scanner</a> — AI-powered radio frequency discovery for Uniden SDS100/SDS200 scanners</p>
    <p style="margin-top:0.4rem;">© ${new Date().getFullYear()} Boy &amp; A Scanner</p>
  </footer>
</body>
</html>`;
}

// ─── SEO: Git Push ────────────────────────────────────────────────────────────

function git(args, cwd) {
    return execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString().trim();
}

async function pushSeoPages(entries) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.log('  ⚠️  GITHUB_TOKEN or GITHUB_REPO not set — skipping SEO push.');
        return { pushed: 0, skipped: true };
    }

    const repoUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;

    // Clean and clone
    if (existsSync(SEO_BUILD_DIR)) rmSync(SEO_BUILD_DIR, { recursive: true, force: true });
    mkdirSync(SEO_BUILD_DIR, { recursive: true });

    console.log(`  ▸ Cloning ${GITHUB_REPO}...`);
    try {
        git(`clone --depth 1 ${repoUrl} .`, SEO_BUILD_DIR);
    } catch (err) {
        // Repo may be empty / new — init it
        git('init', SEO_BUILD_DIR);
        git(`remote add origin ${repoUrl}`, SEO_BUILD_DIR);
    }

    // Set git identity (required for commits on CI/VMs)
    git('config user.email "precacher@boyandascanner.com"', SEO_BUILD_DIR);
    git('config user.name "Boy & A Scanner Pre-Cacher"', SEO_BUILD_DIR);

    // Build /frequencies/ directory
    const freqDir = join(SEO_BUILD_DIR, 'frequencies');
    mkdirSync(freqDir, { recursive: true });

    // Write index page
    writeFileSync(join(freqDir, 'index.html'), renderIndexPage(entries), 'utf-8');

    // Write per-ZIP pages
    let written = 0;
    for (const entry of entries) {
        if (!entry.result_data) continue;
        // Extract ZIP from cache key (format: loc_{zip}_[services] or v6_loc_{zip})
        const keyMatch = entry.search_key.match(/loc_(\d{5})/);
        if (!keyMatch) continue;
        const zip = keyMatch[1];

        const zipDir = join(freqDir, zip);
        mkdirSync(zipDir, { recursive: true });
        writeFileSync(join(zipDir, 'index.html'), renderSeoPage(zip, entry), 'utf-8');
        written++;
    }

    console.log(`  ▸ Rendered ${written} ZIP pages + index`);

    // Write vercel.json if not present (clean trailingSlash + SPA config for the SEO repo)
    const vercelConfig = join(SEO_BUILD_DIR, 'vercel.json');
    if (!existsSync(vercelConfig)) {
        writeFileSync(vercelConfig, JSON.stringify({ trailingSlash: false, cleanUrls: true }, null, 2), 'utf-8');
    }

    // Commit and push
    git('add -A', SEO_BUILD_DIR);
    const diff = git('status --porcelain', SEO_BUILD_DIR);
    if (!diff) {
        console.log('  ▸ No changes to push.');
        rmSync(SEO_BUILD_DIR, { recursive: true, force: true });
        return { pushed: 0, unchanged: true };
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    git(`commit -m "chore: update SEO pages ${timestamp} (${written} locations)"`, SEO_BUILD_DIR);

    try {
        git('push origin main', SEO_BUILD_DIR);
    } catch {
        // Branch may not exist yet on a fresh repo
        git('push --set-upstream origin main', SEO_BUILD_DIR);
    }

    rmSync(SEO_BUILD_DIR, { recursive: true, force: true });
    console.log(`  ▸ ✅ Pushed ${written} pages to ${GITHUB_REPO}`);
    return { pushed: written };
}



run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
