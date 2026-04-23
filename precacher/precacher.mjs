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
 *   node precacher.mjs --rr-upgrade-only # RR-upgrade a nightly batch of AI-only ZIP cache rows
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

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
const AI_MODEL = process.env.AI_MODEL?.trim() || (AI_PROVIDER === 'openrouter' ? 'moonshotai/kimi-k2' : 'gemini-2.5-flash');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'https://www.boyandascanner.com';
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || 'Boy & A Scanner Precacher';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DELAY_MS = (parseInt(process.env.DELAY_SECONDS) || 5) * 1000;
const HOT_MAX_AGE_MS = (parseInt(process.env.HOT_MAX_AGE_HOURS) || parseInt(process.env.MAX_AGE_HOURS) || 24) * 60 * 60 * 1000;
const WARM_MAX_AGE_MS = (parseInt(process.env.WARM_MAX_AGE_HOURS) || 168) * 60 * 60 * 1000;
const MAX_SEED_ZIPS = parseInt(process.env.MAX_SEED_ZIPS) || 150;
const MAX_RECENT_SEARCH_ZIPS = parseInt(process.env.MAX_RECENT_SEARCH_ZIPS) || 125;
const MAX_FAVORITE_ZIPS = parseInt(process.env.MAX_FAVORITE_ZIPS) || 75;
const MAX_REPORT_ZIPS = parseInt(process.env.MAX_REPORT_ZIPS) || 75;
const EXPAND_SEED_ZIPS = process.env.EXPAND_SEED_ZIPS !== '0';
const MAX_SEED_APPEND_PER_RUN = parseInt(process.env.MAX_SEED_APPEND_PER_RUN) || 40;
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
const RR_USERNAME = process.env.RR_USERNAME;
const RR_PASSWORD = process.env.RR_PASSWORD;
const RR_REFRESH_ENABLED = process.env.RR_REFRESH_ENABLED === '1';
const RR_REFRESH_HOT_ONLY = process.env.RR_REFRESH_HOT_ONLY !== '0';
const RR_UPGRADE_ENABLED = process.env.RR_UPGRADE_ENABLED !== '0';
const RR_UPGRADE_BATCH_SIZE = parseInt(process.env.RR_UPGRADE_BATCH_SIZE) || 15;
const RR_UPGRADE_STATE_FILE = join(__dirname, '.rr-upgrade-state.json');
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
const IS_CACHE_ONLY = process.argv.includes('--cache-only');
const IS_RR_UPGRADE_ONLY = process.argv.includes('--rr-upgrade-only');

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing env vars. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
}

if (AI_PROVIDER === 'gemini' && !GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is required when AI_PROVIDER=gemini.');
    process.exit(1);
}

if (AI_PROVIDER === 'openrouter' && !OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter.');
    process.exit(1);
}

const ai = AI_PROVIDER === 'gemini' ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function isApiResult(resultData) {
    return resultData?.source === 'API';
}

function readJsonFileIfExists(filePath) {
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function writeJsonFile(filePath, value) {
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function normalizeZip(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^\d{5}$/.test(trimmed) ? trimmed : null;
}

function extractZipFromSearchKey(searchKey) {
    if (typeof searchKey !== 'string') return null;
    const match = searchKey.match(/^v6_loc_(\d{5})$/i);
    return match ? match[1] : null;
}

function addZipSignal(map, zip, priority, reason) {
    if (!zip) return;

    const existing = map.get(zip);
    if (!existing) {
        map.set(zip, { zip, priority, reasons: [reason] });
        return;
    }

    if (priority === 'hot' && existing.priority !== 'hot') {
        existing.priority = 'hot';
    }
    if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
    }
}

function describePlan(plan) {
    const hot = plan.filter(item => item.priority === 'hot').length;
    const warm = plan.length - hot;
    return { hot, warm, total: plan.length };
}

function countReasons(plan) {
    const counts = {};
    for (const item of plan) {
        for (const reason of item.reasons) {
            counts[reason] = (counts[reason] || 0) + 1;
        }
    }
    return counts;
}

function createPriorityStats() {
    return {
        hot: { cached: 0, skipped: 0, failed: 0 },
        warm: { cached: 0, skipped: 0, failed: 0 },
    };
}

function logPrioritySummary(priorityStats) {
    console.log('  RESULTS BY PRIORITY');
    for (const priority of ['hot', 'warm']) {
        const stats = priorityStats[priority];
        console.log(`  ${priority.padEnd(4)} cached=${stats.cached} skipped=${stats.skipped} failed=${stats.failed}`);
    }
}

function persistExpandedZipSeeds(plan) {
    if (!EXPAND_SEED_ZIPS || IS_TEST || plan.length === 0) return 0;

    const current = new Set(ZIPCODES.map(normalizeZip).filter(Boolean));
    const additions = [];

    for (const item of plan) {
        if (additions.length >= MAX_SEED_APPEND_PER_RUN) break;
        if (item.priority !== 'hot' || current.has(item.zip)) continue;

        current.add(item.zip);
        additions.push(item.zip);
    }

    if (additions.length === 0) return 0;

    const nextZipcodes = Array.from(current).sort();
    writeFileSync(join(__dirname, 'zipcodes.json'), `${JSON.stringify(nextZipcodes, null, 2)}\n`, 'utf-8');
    return additions.length;
}

// ─── Dynamic ZIP Discovery ──────────────────────────────────────────────────

/**
 * Pull recent ZIP code searches from the cache table.
 * This uses recency as a proxy for demand instead of expanding forever.
 */
async function getRecentSearchedZips(limit = MAX_RECENT_SEARCH_ZIPS) {
    try {
        const { data, error } = await supabase
            .from('search_cache')
            .select('search_key, updated_at')
            .like('search_key', 'v6_loc_%')
            .order('updated_at', { ascending: false })
            .limit(limit * 4);

        if (error || !data) return [];

        const zips = [];
        for (const row of data) {
            const zip = extractZipFromSearchKey(row.search_key);
            if (zip && !zips.includes(zip)) {
                zips.push(zip);
            }
            if (zips.length >= limit) {
                break;
            }
        }
        return zips;
    } catch (e) {
        console.warn('⚠️  Could not fetch recent ZIP searches from Supabase:', e.message);
        return [];
    }
}

async function getFavoriteZips(limit = MAX_FAVORITE_ZIPS) {
    try {
        const { data, error } = await supabase
            .from('favorites')
            .select('location_query, created_at')
            .order('created_at', { ascending: false })
            .limit(limit * 4);

        if (error || !data) return [];

        const zips = [];
        for (const row of data) {
            const zip = normalizeZip(row.location_query);
            if (zip && !zips.includes(zip)) {
                zips.push(zip);
            }
            if (zips.length >= limit) {
                break;
            }
        }
        return zips;
    } catch (e) {
        console.warn('⚠️  Could not fetch favorite ZIPs from Supabase:', e.message);
        return [];
    }
}

async function getReportedZips(limit = MAX_REPORT_ZIPS) {
    try {
        const { data, error } = await supabase
            .from('frequency_reports')
            .select('location_query, created_at')
            .order('created_at', { ascending: false })
            .limit(limit * 4);

        if (error || !data) return [];

        const zips = [];
        for (const row of data) {
            const zip = normalizeZip(row.location_query);
            if (zip && !zips.includes(zip)) {
                zips.push(zip);
            }
            if (zips.length >= limit) {
                break;
            }
        }
        return zips;
    } catch (e) {
        console.warn('⚠️  Could not fetch community ZIP activity from Supabase:', e.message);
        return [];
    }
}

async function buildZipPlan() {
    const planMap = new Map();

    ZIPCODES.slice(0, MAX_SEED_ZIPS).forEach(zip => addZipSignal(planMap, normalizeZip(zip), 'warm', 'seed'));

    const [recentSearches, favoriteZips, reportedZips] = await Promise.all([
        getRecentSearchedZips(),
        getFavoriteZips(),
        getReportedZips(),
    ]);

    recentSearches.forEach(zip => addZipSignal(planMap, zip, 'hot', 'recent-search'));
    favoriteZips.forEach(zip => addZipSignal(planMap, zip, 'hot', 'favorite'));
    reportedZips.forEach(zip => addZipSignal(planMap, zip, 'hot', 'community'));

    return [...planMap.values()].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'hot' ? -1 : 1;
        return b.reasons.length - a.reasons.length;
    });
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function makeCacheKey(zip) {
    return `v6_loc_${zip}`;
}

async function isFresh(cacheKey, maxAgeMs) {
    try {
        const { data, error } = await supabase
            .from('search_cache')
            .select('updated_at')
            .eq('search_key', cacheKey)
            .single();

        if (error || !data || !data.updated_at) return false;

        const age = Date.now() - new Date(data.updated_at).getTime();
        return age < maxAgeMs;
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

function normalizeName(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergeResults(rr, aiResult) {
    const merged = JSON.parse(JSON.stringify(rr));
    merged.source = 'API';
    merged.summary = `${rr.summary || rr.locationName || aiResult?.locationName || 'RadioReference data'} (Enhanced with AI discovery)`;

    // RR responses frequently omit coords, so preserve AI coords for map rendering.
    if ((merged?.coords?.lat == null || merged?.coords?.lng == null)
        && aiResult?.coords?.lat != null
        && aiResult?.coords?.lng != null) {
        merged.coords = aiResult.coords;
    }

    const existingAgencies = new Set((merged.agencies || []).map((agency) => normalizeName(agency.name)));
    for (const agency of aiResult?.agencies || []) {
        const key = normalizeName(agency.name);
        if (!existingAgencies.has(key)) {
            merged.agencies.push(agency);
            existingAgencies.add(key);
        }
    }

    const existingSystems = new Set((merged.trunkedSystems || []).map((system) => normalizeName(system.name)));
    for (const system of aiResult?.trunkedSystems || []) {
        const key = normalizeName(system.name);
        if (!existingSystems.has(key)) {
            merged.trunkedSystems.push(system);
            existingSystems.add(key);
        }
    }

    return merged;
}

async function fetchFromRadioReference(zip) {
    if (!RR_REFRESH_ENABLED || !RR_USERNAME || !RR_PASSWORD || !APP_BASE_URL) return null;

    const response = await fetch(`${APP_BASE_URL}/api/rrdb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            zipcode: zip,
            rrUsername: RR_USERNAME,
            rrPassword: RR_PASSWORD,
            serviceTypes: SERVICE_TYPES,
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `RadioReference refresh failed (${response.status})`);
    }

    return payload?.data || null;
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
            model: AI_MODEL,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
        });
    } catch (err) {
        const msg = err.message || JSON.stringify(err);
        if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
            console.warn(`   └─ Google Search Tool rejected, retrying without tools...`);
            usedTools = false;
            response = await ai.models.generateContent({
                model: AI_MODEL,
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

async function fetchFromOpenRouter(zip) {
    const prompt = buildPrompt(zip);
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': OPENROUTER_SITE_URL,
            'X-Title': OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
            model: AI_MODEL,
            temperature: 0.1,
            messages: [
                { role: 'system', content: 'Return only the requested JSON payload inside a json code block. Do not add prose.' },
                { role: 'user', content: prompt },
            ],
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `OpenRouter request failed (${response.status})`);
    }

    const text = payload?.choices?.[0]?.message?.content || '{}';
    let data = null;

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
        data.agencies.forEach((agency) => { if (!Array.isArray(agency.frequencies)) agency.frequencies = []; });
        data.trunkedSystems.forEach((system) => {
            if (!Array.isArray(system.talkgroups)) system.talkgroups = [];
            if (!Array.isArray(system.frequencies)) system.frequencies = [];
        });
    }

    return { data, groundingChunks: [] };
}

async function fetchFromAi(zip) {
    return AI_PROVIDER === 'openrouter' ? fetchFromOpenRouter(zip) : fetchFromGemini(zip);
}

async function runNightlyRrUpgradePass() {
    if (!RR_UPGRADE_ENABLED) {
        console.log('RR nightly upgrade pass is disabled by RR_UPGRADE_ENABLED=0.');
        return;
    }

    if (!RR_USERNAME || !RR_PASSWORD || !APP_BASE_URL) {
        throw new Error('RR nightly upgrade requires RR_USERNAME, RR_PASSWORD, and APP_BASE_URL.');
    }

    const startTime = Date.now();
    const state = loadRrUpgradeState();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  BOY & A SCANNER — NIGHTLY RR CACHE UPGRADE');
    console.log(`  Batch size: ${RR_UPGRADE_BATCH_SIZE}`);
    console.log(`  Last cursor: ${state.lastSearchKey || 'start of list'}`);
    console.log(`  Failed retry queue: ${state.failedSearchKeys.length}`);
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');

    const candidates = await fetchAiOnlyZipCacheEntries();
    console.log(`  Found ${candidates.length} AI-only ZIP cache rows eligible for RR upgrade.`);

    if (candidates.length === 0) {
        saveRrUpgradeState({ lastSearchKey: null, lastRunAt: new Date().toISOString(), failedSearchKeys: [] });
        console.log('  Nothing to upgrade.');
        return;
    }

    const retryBatch = selectEntriesBySearchKeys(candidates, state.failedSearchKeys, RR_UPGRADE_BATCH_SIZE);
    const retryKeys = new Set(retryBatch.map((entry) => entry.search_key));
    const remainingSlots = Math.max(0, RR_UPGRADE_BATCH_SIZE - retryBatch.length);
    const sequentialBatch = selectRrUpgradeBatch(candidates, remainingSlots, state.lastSearchKey, retryKeys);
    const batch = [...retryBatch, ...sequentialBatch];

    if (retryBatch.length > 0) {
        console.log(`  Retrying ${retryBatch.length} failed RR rows first.`);
    }
    console.log(`  Processing ${batch.length} rows this run.`);

    let upgraded = 0;
    let skipped = 0;
    let failed = 0;
    let lastProcessedKey = state.lastSearchKey;
    const nextFailedKeys = [];

    for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        const zip = extractZipFromSearchKey(entry.search_key);
        const progress = `[${i + 1}/${batch.length}]`;
        const isRetry = retryKeys.has(entry.search_key);

        if (!zip) {
            console.log(`${progress} ${entry.search_key} — SKIP (not a ZIP cache key)`);
            skipped++;
            if (!isRetry) {
                lastProcessedKey = entry.search_key;
            }
            continue;
        }

        console.log(`${progress} ${zip} — upgrading AI cache with RadioReference${isRetry ? ' (retry)' : ''}...`);

        try {
            const rrData = await fetchFromRadioReference(zip);
            if (!rrData || ((rrData.agencies?.length || 0) === 0 && (rrData.trunkedSystems?.length || 0) === 0)) {
                console.log('   └─ RR returned no usable data; leaving AI cache in place.');
                skipped++;
            } else {
                const mergedData = entry.result_data ? mergeResults(rrData, entry.result_data) : rrData;
                mergedData.source = 'API';
                const ok = await saveToCache(entry.search_key, mergedData, entry.grounding_chunks || null);
                if (ok) {
                    upgraded++;
                    console.log(`   └─ ✅ Upgraded ${entry.search_key} to RR-backed cache.`);
                } else {
                    failed++;
                }
            }
        } catch (error) {
            console.error(`   └─ ❌ Error: ${error.message}`);
            failed++;
            nextFailedKeys.push(entry.search_key);
        }

        if (!isRetry) {
            lastProcessedKey = entry.search_key;
        }

        if (i < batch.length - 1) {
            await sleep(DELAY_MS);
        }
    }

    saveRrUpgradeState({
        lastSearchKey: lastProcessedKey,
        lastRunAt: new Date().toISOString(),
        failedSearchKeys: Array.from(new Set(nextFailedKeys)),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('  NIGHTLY RR UPGRADE RESULTS');
    console.log(`  ✅ Upgraded: ${upgraded}`);
    console.log(`  ⏭️  Skipped:  ${skipped}`);
    console.log(`  ❌ Failed:   ${failed}`);
    console.log(`  ⏱️  Elapsed:  ${elapsed}s`);
    console.log(`  Next cursor: ${lastProcessedKey || 'start of list'}`);
    console.log(`  Retry next run: ${nextFailedKeys.length}`);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function run() {
    if (IS_RR_UPGRADE_ONLY) {
        await runNightlyRrUpgradePass();
        return;
    }

    const startTime = Date.now();

    let zipPlan = [];
    if (!IS_SEO_ONLY) {
        if (IS_TEST) {
            zipPlan = ZIPCODES.slice(0, 3).map(zip => ({ zip, priority: 'hot', reasons: ['test-seed'] }));
        } else {
            console.log('  Building ZIP refresh plan from seed, recent searches, favorites, and community activity...');
            zipPlan = await buildZipPlan();
            const expandedBy = persistExpandedZipSeeds(zipPlan);
            if (expandedBy > 0) {
                console.log(`  Expanded seed ZIP list by ${expandedBy} new hot ZIPs for future weekly runs.`);
            }
        }
    }

    const planSummary = describePlan(zipPlan);
    const reasonCounts = countReasons(zipPlan);
    let modeLabel;
    if (IS_SEO_ONLY) {
        modeLabel = 'SEO ONLY';
    } else if (IS_CACHE_ONLY) {
        modeLabel = IS_TEST ? 'CACHE ONLY TEST (3 ZIPs)' : `CACHE ONLY (${planSummary.total} ZIPs)`;
    } else if (IS_TEST) {
        modeLabel = 'TEST (3 ZIPs, SEO skipped)';
    } else {
        modeLabel = `FULL (${planSummary.total} ZIPs + SEO)`;
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  BOY & A SCANNER — PRE-CACHER + SEO GENERATOR');
    console.log(`  Mode: ${modeLabel}`);
    if (!IS_SEO_ONLY) {
        console.log(`  AI provider/model: ${AI_PROVIDER}/${AI_MODEL}`);
        console.log(`  Delay: ${DELAY_MS / 1000}s between calls`);
        console.log(`  Hot ZIP max age: ${HOT_MAX_AGE_MS / 3600000}h`);
        console.log(`  Warm ZIP max age: ${WARM_MAX_AGE_MS / 3600000}h`);
        console.log(`  ZIP plan: ${planSummary.hot} hot, ${planSummary.warm} warm`);
        console.log(`  ZIP signals: ${Object.entries(reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}`);
        if (RR_REFRESH_ENABLED) {
            console.log(`  RR weekly assist: ${RR_REFRESH_HOT_ONLY ? 'hot ZIPs only' : 'all ZIPs'} via ${APP_BASE_URL || 'APP_BASE_URL not set'}`);
        }
    }
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');

    // ── Phase 1: Pre-Cache ──────────────────────────────────────────────────

    let cached = 0;
    let skipped = 0;
    let failed = 0;
    const priorityStats = createPriorityStats();

    if (!IS_SEO_ONLY) {
        console.log('');
        console.log('  PHASE 1 — PRE-CACHE');
        console.log('───────────────────────────────────────────────────────────');

        for (let i = 0; i < zipPlan.length; i++) {
            const { zip, priority, reasons } = zipPlan[i];
            const cacheKey = makeCacheKey(zip);
            const progress = `[${i + 1}/${zipPlan.length}]`;
            const maxAgeMs = priority === 'hot' ? HOT_MAX_AGE_MS : WARM_MAX_AGE_MS;
            const reasonLabel = reasons.join(',');

            const fresh = await isFresh(cacheKey, maxAgeMs);
            if (fresh) {
                console.log(`${progress} ${zip} — SKIP (${priority}, ${reasonLabel}, fresh)`);
                skipped++;
                priorityStats[priority].skipped++;
                continue;
            }

            console.log(`${progress} ${zip} — fetching from ${AI_PROVIDER}${RR_REFRESH_ENABLED && (!RR_REFRESH_HOT_ONLY || priority === 'hot') ? ' + RR' : ''}... (${priority}, ${reasonLabel})`);

            try {
                const { data: aiData, groundingChunks } = await fetchFromAi(zip);
                let masterData = aiData;

                if (RR_REFRESH_ENABLED && (!RR_REFRESH_HOT_ONLY || priority === 'hot')) {
                    try {
                        const rrData = await fetchFromRadioReference(zip);
                        if (rrData && (rrData.agencies?.length > 0 || rrData.trunkedSystems?.length > 0)) {
                            masterData = aiData ? mergeResults(rrData, aiData) : rrData;
                            masterData.source = 'API';
                            console.log('   └─ RadioReference refresh merged for this ZIP.');
                        }
                    } catch (rrError) {
                        console.warn(`   └─ RR assist skipped: ${rrError.message}`);
                    }
                }

                if (masterData && (masterData.agencies?.length > 0 || masterData.trunkedSystems?.length > 0)) {
                    const ok = await saveToCache(cacheKey, masterData, groundingChunks);
                    if (ok) {
                        const agencyCount = masterData.agencies?.length || 0;
                        const trsCount = masterData.trunkedSystems?.length || 0;
                        console.log(`   └─ ✅ Cached: ${masterData.locationName || zip} (${agencyCount} agencies, ${trsCount} trunked)`);
                        cached++;
                        priorityStats[priority].cached++;
                    } else {
                        failed++;
                        priorityStats[priority].failed++;
                    }
                } else {
                    console.log(`   └─ ⚠️  No data returned for ${zip}`);
                    failed++;
                    priorityStats[priority].failed++;
                }
            } catch (err) {
                console.error(`   └─ ❌ Error: ${err.message}`);
                failed++;
                priorityStats[priority].failed++;

                // If rate limited, wait longer
                if (err.message?.includes('429') || err.message?.includes('RATE')) {
                    console.log('   └─ Rate limited! Waiting 60s...');
                    await sleep(60000);
                }
            }

            // Delay between calls
            if (i < zipPlan.length - 1) {
                await sleep(DELAY_MS);
            }
        }

        const elapsed1 = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('');
        console.log('  PHASE 1 RESULTS');
        console.log(`  ✅ Cached:  ${cached}`);
        console.log(`  ⏭️  Skipped: ${skipped}`);
        console.log(`  ❌ Failed:  ${failed}`);
        logPrioritySummary(priorityStats);
        console.log(`  ⏱️  Elapsed: ${elapsed1}s`);
    }

    // ── Phase 2: SEO Page Generation ───────────────────────────────────────

    if (!IS_TEST && !IS_CACHE_ONLY) {
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
            if (!seoResult.skipped) {
                console.log(`  📄 SEO input ZIP entries: ${entries.length}`);
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

        allRows = allRows.concat(data.filter(row => !!extractZipFromSearchKey(row.search_key)));
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return allRows;
}

async function fetchAiOnlyZipCacheEntries() {
    const PAGE_SIZE = 1000;
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabase
            .from('search_cache')
            .select('search_key, result_data, grounding_chunks, updated_at')
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error(`   └─ Supabase read error: ${error.message}`);
            break;
        }
        if (!data || data.length === 0) break;

        allRows = allRows.concat(
            data.filter((row) => {
                const zip = extractZipFromSearchKey(row.search_key);
                return Boolean(zip) && !isApiResult(row.result_data);
            })
        );

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return allRows.sort((a, b) => a.search_key.localeCompare(b.search_key));
}

function loadRrUpgradeState() {
    const state = readJsonFileIfExists(RR_UPGRADE_STATE_FILE) || {};
    return {
        lastSearchKey: typeof state.lastSearchKey === 'string' ? state.lastSearchKey : null,
        lastRunAt: typeof state.lastRunAt === 'string' ? state.lastRunAt : null,
        failedSearchKeys: Array.isArray(state.failedSearchKeys)
            ? state.failedSearchKeys.filter((value) => typeof value === 'string')
            : [],
    };
}

function saveRrUpgradeState(state) {
    writeJsonFile(RR_UPGRADE_STATE_FILE, state);
}

function selectEntriesBySearchKeys(entries, searchKeys, batchSize) {
    if (!Array.isArray(searchKeys) || searchKeys.length === 0 || batchSize <= 0) return [];

    const byKey = new Map(entries.map((entry) => [entry.search_key, entry]));
    const selected = [];
    const seen = new Set();

    for (const searchKey of searchKeys) {
        const entry = byKey.get(searchKey);
        if (!entry || seen.has(searchKey)) continue;
        seen.add(searchKey);
        selected.push(entry);
        if (selected.length >= batchSize) break;
    }

    return selected;
}

function selectRrUpgradeBatch(entries, batchSize, lastSearchKey, excludedKeys = new Set()) {
    if (entries.length === 0 || batchSize <= 0) return [];

    let startIndex = 0;
    if (lastSearchKey) {
        const nextIndex = entries.findIndex((entry) => entry.search_key > lastSearchKey);
        startIndex = nextIndex === -1 ? 0 : nextIndex;
    }

    const selected = [];
    const seen = new Set();

    for (let offset = 0; offset < entries.length && selected.length < batchSize; offset++) {
        const index = (startIndex + offset) % entries.length;
        const entry = entries[index];
        if (seen.has(entry.search_key) || excludedKeys.has(entry.search_key)) continue;
        seen.add(entry.search_key);
        selected.push(entry);
    }

    return selected;
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
