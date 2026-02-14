
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

    // Inject Source: Cache
    if (result && typeof result === 'object') {
      result.source = 'Cache';
      // Safety normalization
      if (result.trunkedSystems) {
        result.trunkedSystems.forEach((s: any) => { if (!s.frequencies) s.frequencies = []; });
      }
      if (result.locations) {
        result.locations.forEach((loc: any) => {
          if (loc.data) {
            loc.data.source = 'Cache';
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

export const searchFrequencies = async (locationQuery: string, serviceTypes: ServiceType[] = ['Police', 'Fire', 'EMS'], rrCredentials?: RRCredentials): Promise<SearchResponse> => {
  const safeLocation = sanitizeForPrompt(locationQuery);
  const sortedServices = [...serviceTypes].sort().join('-');
  const cacheKey = `v3_loc_${safeLocation}_[${sortedServices}]`.toLowerCase().replace(/\s+/g, '');

  // Check cache first (passing credentials to allow quality overwrite)
  const cached = await getFromCache(cacheKey, rrCredentials);
  if (cached) {
    console.log(`Cache Hit for ${safeLocation}`);
    return { data: cached.data, groundingChunks: cached.groundingChunks, rawText: "Retrieved from Cache" };
  }

  console.log(`Cache Miss (or Quality Overwrite) for ${safeLocation}.`);

  // --- Try RadioReference Direct API first (ZIP codes only, requires RR credentials) ---
  const isZip = /^\d{5}$/.test(safeLocation.trim());
  if (isZip && rrCredentials) {
    try {
      console.log(`Attempting RadioReference Direct API for ZIP ${safeLocation}...`);
      const rrData = await fetchFromRadioReference(safeLocation.trim(), rrCredentials, serviceTypes);

      if (rrData && (rrData.agencies?.length > 0 || rrData.trunkedSystems?.length > 0)) {
        // Save to cache
        await saveToCache(cacheKey, rrData, null);
        return { data: rrData, groundingChunks: null, rawText: "Retrieved from RadioReference API" };
      }
    } catch (rrErr: any) {
      console.warn("RadioReference API failed, falling back to AI:", rrErr.message);
      // Fall through to AI search
    }
  }

  // --- Fallback: AI-powered search via Gemini ---
  console.log(`Using AI search for ${safeLocation}...`);
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: safeLocation, serviceTypes })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Search request failed');
  }

  const result = await response.json();
  const { data, groundingChunks, rawText } = result;

  // Save to cache if we got valid data
  if (data && (data.agencies?.length > 0 || data.trunkedSystems?.length > 0)) {
    await saveToCache(cacheKey, data, groundingChunks);
  }

  return { data, groundingChunks, rawText };
};

export const planTrip = async (start: string, end: string, serviceTypes: ServiceType[]): Promise<{ trip: TripResult | null, groundingChunks: any[] }> => {
  const safeStart = sanitizeForPrompt(start);
  const safeEnd = sanitizeForPrompt(end);
  const sortedServices = [...serviceTypes].sort().join('-');
  const cacheKey = `v3_trip_${safeStart}_to_${safeEnd}_[${sortedServices}]`.toLowerCase().replace(/\s+/g, '');

  // Check cache first
  const cached = await getFromCache(cacheKey);
  if (cached) {
    return { trip: cached.data, groundingChunks: cached.groundingChunks };
  }

  // Call the secure serverless API route (API key stays on server)
  const response = await fetch('/api/trip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: safeStart, end: safeEnd, serviceTypes })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Trip planning request failed');
  }

  const result = await response.json();
  const { trip, groundingChunks } = result;

  // Save to cache if we got valid data
  if (trip && trip.locations?.length > 0) {
    await saveToCache(cacheKey, trip, groundingChunks);
  }

  return { trip, groundingChunks };
};
