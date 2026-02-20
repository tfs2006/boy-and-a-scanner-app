#!/usr/bin/env node
/**
 * Boy & A Scanner — Pre-Cacher Service
 * 
 * Runs on cron (systemd timer) to pre-cache frequency data for popular ZIP codes.
 * Calls Gemini API directly and writes results to Supabase search_cache table.
 * 
 * Usage:
 *   node precacher.mjs          # Full run (all ZIPs)
 *   node precacher.mjs --test   # Test mode (first 3 ZIPs only)
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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
const SERVICE_TYPES = ['Police', 'Fire', 'EMS'];
const SERVICES_KEY = 'ems-fire-police'; // sorted, lowered — matches app's key format

const IS_TEST = process.argv.includes('--test');

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing env vars. Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Cache Helpers ────────────────────────────────────────────────────────────

function makeCacheKey(zip) {
    return `loc_${zip}_[${SERVICES_KEY}]`;
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
    const zips = IS_TEST ? ZIPCODES.slice(0, 3) : ZIPCODES;
    const startTime = Date.now();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  BOY & A SCANNER — PRE-CACHER SERVICE');
    console.log(`  Mode: ${IS_TEST ? 'TEST (3 ZIPs)' : `FULL (${zips.length} ZIPs)`}`);
    console.log(`  Delay: ${DELAY_MS / 1000}s between calls`);
    console.log(`  Max age: ${MAX_AGE_MS / 3600000}h`);
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');

    let cached = 0;
    let skipped = 0;
    let failed = 0;

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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  RESULTS');
    console.log(`  ✅ Cached:  ${cached}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Failed:  ${failed}`);
    console.log(`  ⏱️  Elapsed: ${elapsed}s`);
    console.log(`  Finished: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Go ───────────────────────────────────────────────────────────────────────

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
