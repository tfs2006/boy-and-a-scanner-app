
import { SearchResponse, ScanResult, TripResult, ServiceType } from "../types";
import { sanitizeForPrompt } from "../utils/security";
import { supabase } from "./supabaseClient";
import { fetchFromRadioReference, RRCredentials } from "./rrApi";

// --- Caching Helpers ---

async function getFromCache(key: string, rrCredentials?: RRCredentials): Promise<any | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('search_cache')
      .select('result_data, grounding_chunks')
      .eq('search_key', key)
      .single();

    if (error || !data) return null;

    const result = data.result_data;

    // --- QUALITY CHECK (King of the Hill) ---
    // If cache is AI-sourced (Silver) but user has RR Creds (Gold), ignore cache to fetch fresh Gold data.
    if (result && result.source === 'AI' && rrCredentials) {
      console.log("Cache ignored: Overwriting AI data with potential RadioReference data.");
      return null;
    }

    // --- STALE CACHE DETECTION ---
    let isStale = false;
    if (result) {
      if (result.trunkedSystems && Array.isArray(result.trunkedSystems)) {
        const hasOldSchema = result.trunkedSystems.some((sys: any) => sys.frequencies === undefined);
        if (hasOldSchema) isStale = true;
      }
      if (result.locations && Array.isArray(result.locations)) {
        const hasOldTripSchema = result.locations.some((loc: any) =>
          loc.data?.trunkedSystems?.some((sys: any) => sys.frequencies === undefined)
        );
        if (hasOldTripSchema) isStale = true;
      }
    }

    if (isStale) return null;

    // Inject Source: Cache (unless it is premium RadioReference data)
    if (result && typeof result === 'object') {
      // Only overwrite source if it's NOT already 'API' (RadioReference)
      if (result.source !== 'API') {
        result.source = 'Cache';
      }

      // Safety normalization
      if (result.trunkedSystems) {
        result.trunkedSystems.forEach((s: any) => { if (!s.frequencies) s.frequencies = []; });
      }
      if (result.locations) {
        result.locations.forEach((loc: any) => {
          if (loc.data) {
            // Same logic for trip locations
            if (loc.data.source !== 'API') {
              loc.data.source = 'Cache';
            }
            if (loc.data.trunkedSystems) {
              loc.data.trunkedSystems.forEach((s: any) => { if (!s.frequencies) s.frequencies = []; });
            }
          }
        });
      }
    }

    return { data: result, groundingChunks: data.grounding_chunks };
  } catch (e) {
    console.warn("Cache fetch error:", e);
    return null;
  }
}

async function saveToCache(key: string, resultData: any, groundingChunks: any) {
  if (!supabase) return;
  try {
    await supabase.from('search_cache').upsert({
      search_key: key,
      result_data: resultData,
      grounding_chunks: groundingChunks
    }, { onConflict: 'search_key' });
  } catch (e) {
    console.warn("Cache save error:", e);
  }
}

export async function getDatabaseStats(): Promise<number> {
  if (!supabase) return 0;
  try {
    const { count, error } = await supabase
      .from('search_cache')
      .select('*', { count: 'exact', head: true });

    if (error) return 0;
    return count || 0;
  } catch (e) {
    return 0;
  }
}

// --- Main Services (Using Secure Serverless API Routes) ---

// Comprehensive list of services to fetch for the cache
const ALL_SERVICE_TYPES: ServiceType[] = [
  'Police', 'Fire', 'EMS', 'Ham Radio', 'Railroad', 'Air', 'Marine',
  'Federal', 'Military', 'Public Works', 'Utilities', 'Transportation',
  'Business', 'Hospitals', 'Schools', 'Corrections', 'Security', 'Multi-Dispatch'
];

export const searchFrequencies = async (locationQuery: string, userSelectedServices: ServiceType[] = ['Police', 'Fire', 'EMS'], rrCredentials?: RRCredentials): Promise<SearchResponse> => {
  const safeLocation = sanitizeForPrompt(locationQuery);

  // Cache Key is now strictly LOCATION based.
  // v6 was the bug fix version.
  const cacheKey = `v6_loc_${safeLocation}`.toLowerCase().replace(/\s+/g, '');

  console.log(`[Hybrid Search] Starting Fresh Search for ${safeLocation}...`);

  // Parallel Fetch: AI & RadioReference
  const promises: Promise<ScanResult | null>[] = [];

  // 1. AI Search (Always run)
  const aiPromise = (async () => {
    try {
      console.log(`[AI Search] Fetching for ${safeLocation}...`);
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: safeLocation, serviceTypes: ALL_SERVICE_TYPES })
      });
      if (!response.ok) throw new Error('AI Search Failed');
      const json = await response.json();
      const data = json.data;
      if (data) {
        data.source = 'AI'; // Ensure source is marked
        // Mark inner items too
        if (data.agencies) data.agencies.forEach((a: any) => a.origin = 'AI');
        if (data.trunkedSystems) data.trunkedSystems.forEach((s: any) => s.origin = 'AI');
      }
      return data;
    } catch (e) {
      console.warn("AI Search Error:", e);
      return null;
    }
  })();
  promises.push(aiPromise);

  // 2. RadioReference Search (Run if credentials exist)
  let rrPromise: Promise<ScanResult | null> = Promise.resolve(null);
  if (rrCredentials && /^\d{5}$/.test(safeLocation)) {
    rrPromise = (async () => {
      try {
        console.log(`[RR API] Fetching for ${safeLocation}...`);
        const data = await fetchFromRadioReference(safeLocation, rrCredentials, ALL_SERVICE_TYPES);
        if (data) {
          data.source = 'API';
          // Mark inner items
          if (data.agencies) data.agencies.forEach((a: any) => a.origin = 'RR');
          if (data.trunkedSystems) data.trunkedSystems.forEach((s: any) => s.origin = 'RR');
        }
        return data;
      } catch (e) {
        console.warn("RR API Error:", e);
        return null;
      }
    })();
    promises.push(rrPromise);
  } else {
    promises.push(Promise.resolve(null)); // Placeholder to keep indices aligned if needed, though Promise.all works fine
  }

  // Await both
  const [aiResult, rrResult] = await Promise.all([aiPromise, rrPromise]);

  // Master Data will be the merged result
  let masterData: ScanResult | null = null;
  let masterGrounding: any = null; // AI grounding
  let rawText = "";

  // MERGE LOGIC
  if (rrResult && aiResult) {
    console.log(`[Hybrid Merge] Merging RR (${rrResult.agencies?.length} agcy) + AI (${aiResult.agencies?.length} agcy)`);
    masterData = mergeResults(rrResult, aiResult);
    rawText = "Merged Hybrid Results (RR + AI)";
  } else if (rrResult) {
    console.log(`[Hybrid Results] RR Only`);
    masterData = rrResult;
    rawText = "RadioReference Results";
  } else if (aiResult) {
    console.log(`[Hybrid Results] AI Only`);
    masterData = aiResult;
    rawText = "AI Results";
  } else {
    console.log(`[Hybrid Search] All fetches failed. Checking Cache as backup...`);
    // Fallback: Check Cache if everything else failed
    const cached = await getFromCache(cacheKey, rrCredentials);
    if (cached) {
      console.log(`[Cache Backup] Found data.`);
      // Filter and return immediately
      const filteredData = filterDataByServices(cached.data, userSelectedServices);
      return { data: filteredData, groundingChunks: cached.groundingChunks, rawText: "Retrieved from Cache (Offline Backup)" };
    }
    throw new Error("Unable to retrieve frequency data from any source.");
  }

  // 3. Save MASTER RECORD to Cache (Write-Through)
  if (masterData && (masterData.agencies?.length > 0 || masterData.trunkedSystems?.length > 0)) {
    console.log(`[Cache Save] Storing Master Record for ${cacheKey}`);
    // We don't have AI grounding if RR wins/merged, but we can pass null or AI's chunks
    await saveToCache(cacheKey, masterData, masterGrounding);
  }

  // 4. Return FILTERED data to user
  const filteredData = filterDataByServices(masterData, userSelectedServices);
  return { data: filteredData, groundingChunks: masterGrounding, rawText };
};

// --- Merge Helper ---
function mergeResults(rr: ScanResult, ai: ScanResult): ScanResult {
  // Clone RR as base
  const merged = JSON.parse(JSON.stringify(rr));
  merged.source = 'API'; // Keeps 'verified' badge usually
  merged.summary = rr.summary + " (Enhanced with AI discovery)";

  // 1. Merge Agencies
  const existingNames = new Set(merged.agencies.map((a: any) => normalizeName(a.name)));

  if (ai.agencies) {
    for (const aiAgency of ai.agencies) {
      const norm = normalizeName(aiAgency.name);
      // If strictly new, add it
      if (!existingNames.has(norm)) {
        // Potential duplicates via slightly different names? 
        // E.g. "Bingham County Sheriff" vs "Sheriff - Bingham County"
        // Simple strict check for now.
        merged.agencies.push(aiAgency);
        existingNames.add(norm); // Prevent adding twice if AI has dupes
      }
    }
  }

  // 2. Merge Trunked Systems
  const existingSystems = new Set(merged.trunkedSystems.map((s: any) => normalizeName(s.name)));

  if (ai.trunkedSystems) {
    for (const aiSys of ai.trunkedSystems) {
      const norm = normalizeName(aiSys.name);
      if (!existingSystems.has(norm)) {
        merged.trunkedSystems.push(aiSys);
        existingSystems.add(norm);
      }
    }
  }

  return merged;
}

function normalizeName(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const planTrip = async (start: string, end: string, userSelectedServices: ServiceType[]): Promise<{ trip: TripResult | null, groundingChunks: any[] }> => {
  const safeStart = sanitizeForPrompt(start);
  const safeEnd = sanitizeForPrompt(end);

  // Trip Cache is also location-pair based only.
  const cacheKey = `v6_trip_${safeStart}_to_${safeEnd}`.toLowerCase().replace(/\s+/g, '');

  // 1. Check Cache
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log(`[Cache Hit] Trip found.`);
    const filteredTrip = filterTripByServices(cached.data, userSelectedServices);
    return { trip: filteredTrip, groundingChunks: cached.groundingChunks };
  }

  // 2. Fetch MASTER TRIP (All Services)
  console.log(`[Trip Plan] Fetching Master Trip Record...`);
  const response = await fetch('/api/trip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: safeStart, end: safeEnd, serviceTypes: ALL_SERVICE_TYPES })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Trip planning request failed');
  }

  const result = await response.json();
  const masterTrip = result.trip;
  const masterGrounding = result.groundingChunks;

  // 3. Save MASTER TRIP to Cache
  if (masterTrip && masterTrip.locations?.length > 0) {
    await saveToCache(cacheKey, masterTrip, masterGrounding);
  }

  // 4. Return FILTERED trip
  const filteredTrip = filterTripByServices(masterTrip, userSelectedServices);
  return { trip: filteredTrip, groundingChunks: masterGrounding };
};

// --- Filtering Helpers ---

function filterDataByServices(data: ScanResult | null, services: ServiceType[]): ScanResult | null {
  if (!data) return null;

  // Deep copy to avoid mutating cache
  const result = JSON.parse(JSON.stringify(data));
  const allowedcats = new Set(services.map(s => s.toLowerCase()));

  // 1. Filter Agencies
  if (result.agencies) {
    result.agencies = result.agencies.filter((agency: any) => {
      // Heuristic: Check if agency category matches any selected service
      // Map agency category (e.g. "Law Dispatch") to ServiceType (e.g. "Police")
      // We'll use a loose match
      const cat = (agency.category || '').toLowerCase();
      return isCategoryAllowed(cat, allowedcats);
    });
  }

  // 2. Filter Trunked Systems? 
  // Trunked systems often carry ALL traffic. It's safer to keep the system 
  // but maybe filter its talkgroups. For now, strict filtering might hide 
  // control channels needed for scanning.
  // Strategy: Keep all Trunked Systems, but filter Talkgroups.
  if (result.trunkedSystems) {
    result.trunkedSystems.forEach((sys: any) => {
      if (sys.talkgroups) {
        sys.talkgroups = sys.talkgroups.filter((tg: any) => {
          const tag = (tg.tag || tg.description || '').toLowerCase();
          return isCategoryAllowed(tag, allowedcats);
        });
      }
    });
  }

  return result;
}

function filterTripByServices(trip: TripResult | null, services: ServiceType[]): TripResult | null {
  if (!trip) return null;
  const result = JSON.parse(JSON.stringify(trip));

  if (result.locations) {
    result.locations.forEach((loc: any) => {
      if (loc.data) {
        loc.data = filterDataByServices(loc.data, services);
      }
    });
  }
  return result;
}

function isCategoryAllowed(category: string, allowedSet: Set<string>): boolean {
  const c = category.toLowerCase();

  // Robust Keyword Matching for ALL 18 Service Types

  if (allowedSet.has('police')) {
    if (c.includes('law') || c.includes('police') || c.includes('sheriff') || c.includes('patrol') || c.includes('trooper') || c.includes('marshal') || c.includes('constable') || c.includes('detective') || c.includes('fbi') || c.includes('dea') || c.includes('atf')) return true;
  }

  if (allowedSet.has('fire')) {
    if (c.includes('fire') || c.includes('rescue') || c.includes('engine') || c.includes('ladder') || c.includes('battalion') || c.includes('hazmat')) return true;
  }

  if (allowedSet.has('ems')) {
    if (c.includes('ems') || c.includes('medic') || c.includes('ambulance') || c.includes('hospital') || c.includes('paramedic') || c.includes('life flight') || c.includes('rescue')) return true;
  }

  if (allowedSet.has('ham radio')) {
    if (c.includes('ham') || c.includes('amateur') || c.includes('repeater') || c.includes('ares') || c.includes('races') || c.includes('skywarn')) return true;
  }

  if (allowedSet.has('railroad')) {
    if (c.includes('rail') || c.includes('train') || c.includes('locomotive') || c.includes('yard') || c.includes('conductor') || c.includes('union pacific') || c.includes('bnsf') || c.includes('csx') || c.includes('amtrak')) return true;
  }

  if (allowedSet.has('air')) {
    if (c.includes('air') || c.includes('aviation') || c.includes('control tower') || c.includes('approach') || c.includes('departure') || c.includes('ground') || c.includes('unicom') || c.includes('airport') || c.includes('pilot')) return true;
  }

  if (allowedSet.has('marine')) {
    if (c.includes('marine') || c.includes('coast') || c.includes('boat') || c.includes('ship') || c.includes('vessel') || c.includes('port') || c.includes('harbor') || c.includes('marina')) return true;
  }

  if (allowedSet.has('federal')) {
    if (c.includes('federal') || c.includes('fed') || c.includes('govt') || c.includes('government') || c.includes('us ') || c.includes('u.s.') || c.includes('forest service') || c.includes('park service') || c.includes('blm') || c.includes('fbi') || c.includes('tsa') || c.includes('customs') || c.includes('border patrol') || c.includes('ice ') || c.includes('dhs')) return true;
  }

  if (allowedSet.has('military')) {
    if (c.includes('military') || c.includes('army') || c.includes('navy') || c.includes('air force') || c.includes('marines') || c.includes('coast guard') || c.includes('national guard') || c.includes('base') || c.includes('fort') || c.includes('camp ') || c.includes('afb') || c.includes('defense') || c.includes('squadron') || c.includes('wing')) return true;
  }

  if (allowedSet.has('public works')) {
    if (c.includes('public works') || c.includes('dpw') || c.includes('street') || c.includes('road') || c.includes('highway') || c.includes('transportation') || c.includes('dot ') || c.includes('sanitation') || c.includes('garbage') || c.includes('trash') || c.includes('recycling') || c.includes('water') || c.includes('sewer') || c.includes('utility') || c.includes('engineering') || c.includes('maintenance')) return true;
  }

  if (allowedSet.has('utilities')) {
    if (c.includes('utilit') || c.includes('power') || c.includes('electric') || c.includes('gas') || c.includes('energy') || c.includes('water') || c.includes('sewer') || c.includes('cable') || c.includes('internet') || c.includes('phone')) return true;
  }

  if (allowedSet.has('transportation')) {
    if (c.includes('transport') || c.includes('transit') || c.includes('bus') || c.includes('taxi') || c.includes('shuttle') || c.includes('metro') || c.includes('subway') || c.includes('airport') || c.includes('uber') || c.includes('lyft') || c.includes('limo')) return true;
  }

  if (allowedSet.has('business')) {
    if (c.includes('business') || c.includes('commercial') || c.includes('mall') || c.includes('store') || c.includes('shop') || c.includes('factory') || c.includes('plant') || c.includes('warehouse') || c.includes('hotel') || c.includes('motel') || c.includes('casino') || c.includes('resort') || c.includes('logistics') || c.includes('security')) return true;
  }

  if (allowedSet.has('hospitals')) {
    if (c.includes('hospital') || c.includes('medical') || c.includes('clinic') || c.includes('center') || c.includes('health') || c.includes('care') || c.includes('nursing') || c.includes('trauma') || c.includes('er ') || c.includes('emergency room')) return true;
  }

  if (allowedSet.has('schools')) {
    if (c.includes('school') || c.includes('university') || c.includes('college') || c.includes('campus') || c.includes('district') || c.includes('education') || c.includes('academy') || c.includes('student') || c.includes('faculty') || c.includes('bus barn')) return true;
  }

  if (allowedSet.has('corrections')) {
    if (c.includes('correction') || c.includes('prison') || c.includes('jail') || c.includes('detention') || c.includes('penitentiary') || c.includes('warden') || c.includes('inmate') || c.includes('justice center')) return true;
  }

  if (allowedSet.has('security')) {
    if (c.includes('security') || c.includes('patrol') || c.includes('guard') || c.includes('protection') || c.includes('loss prevention') || c.includes('safety')) return true;
  }

  if (allowedSet.has('multi-dispatch')) {
    // Catch-all for dispatch centers that handle multiple agencies
    if (c.includes('dispatch') || c.includes('communication') || c.includes('911') || c.includes('center') || c.includes('interop')) return true;
  }

  // Direct strict check as a fallback
  for (const allowed of allowedSet) {
    if (c.includes(allowed)) return true;
  }

  return false;
}
