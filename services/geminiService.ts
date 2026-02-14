
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

  // Cache Key is now strictly LOCATION based. We dropped the [services] part.
  // This means "84770" always maps to the same cache entry, regardless of what user checked.
  const cacheKey = `v4_loc_${safeLocation}`.toLowerCase().replace(/\s+/g, '');

  console.log(`[Cache Strategy] Checking Universal Cache for key: ${cacheKey}`);

  // 1. Check Cache
  const cached = await getFromCache(cacheKey, rrCredentials);
  if (cached) {
    console.log(`[Cache Hit] Univeral data found for ${safeLocation}`);
    // FILTER: We have everything, but user only asked for specific types.
    const filteredData = filterDataByServices(cached.data, userSelectedServices);
    return { data: filteredData, groundingChunks: cached.groundingChunks, rawText: "Retrieved from Cache" };
  }

  console.log(`[Cache Miss] Fetching MASTER RECORD for ${safeLocation} (All Service Types)...`);

  // 2. Fetch MASTER RECORD (All Services)
  // We ignore userSelectedServices for the fetch, asking for EVERYTHING.
  let masterData: ScanResult | null = null;
  let masterGrounding: any = null;
  let rawText = "";

  // A. Try RadioReference Direct API (if credentials exist and is ZIP)
  const isZip = /^\d{5}$/.test(safeLocation.trim());
  if (isZip && rrCredentials) {
    try {
      console.log(`[RR API] Fetching Master Record for ZIP ${safeLocation}...`);
      masterData = await fetchFromRadioReference(safeLocation.trim(), rrCredentials, ALL_SERVICE_TYPES);
      rawText = "Retrieved from RadioReference API";
    } catch (rrErr: any) {
      console.warn("RadioReference API failed, falling back to AI:", rrErr.message);
    }
  }

  // B. Fallback to AI
  if (!masterData) {
    console.log(`[AI Search] Fetching Master Record for ${safeLocation}...`);
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: safeLocation, serviceTypes: ALL_SERVICE_TYPES })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Search request failed');
    }

    const result = await response.json();
    masterData = result.data;
    masterGrounding = result.groundingChunks;
    rawText = result.rawText;
  }

  // 3. Save MASTER RECORD to Cache
  if (masterData && (masterData.agencies?.length > 0 || masterData.trunkedSystems?.length > 0)) {
    console.log(`[Cache Save] Storing Master Record for ${safeLocation}`);
    await saveToCache(cacheKey, masterData, masterGrounding);
  }

  // 4. Return FILTERED data to user
  const filteredData = filterDataByServices(masterData, userSelectedServices);
  return { data: filteredData, groundingChunks: masterGrounding, rawText };
};

export const planTrip = async (start: string, end: string, userSelectedServices: ServiceType[]): Promise<{ trip: TripResult | null, groundingChunks: any[] }> => {
  const safeStart = sanitizeForPrompt(start);
  const safeEnd = sanitizeForPrompt(end);

  // Trip Cache is also location-pair based only.
  const cacheKey = `v4_trip_${safeStart}_to_${safeEnd}`.toLowerCase().replace(/\s+/g, '');

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

  // Mappings
  if (allowedSet.has('police') && (c.includes('law') || c.includes('police') || c.includes('sheriff') || c.includes('patrol'))) return true;
  if (allowedSet.has('fire') && (c.includes('fire') || c.includes('rescue'))) return true;
  if (allowedSet.has('ems') && (c.includes('ems') || c.includes('medic') || c.includes('ambulance') || c.includes('hospital'))) return true;
  if (allowedSet.has('railroad') && (c.includes('rail'))) return true;
  if (allowedSet.has('air') && (c.includes('air') || c.includes('aviation'))) return true;
  if (allowedSet.has('marine') && (c.includes('marine') || c.includes('coast'))) return true;

  // Direct matches
  for (const allowed of allowedSet) {
    if (c.includes(allowed)) return true;
  }

  // If "Multi-Dispatch" or "Other" is implicit, maybe allow?
  // For now, strict-ish.
  return false;
}
