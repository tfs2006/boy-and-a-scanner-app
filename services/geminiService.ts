
import { SearchResponse, ScanResult, TripResult, ServiceType } from "../types";
import { sanitizeForPrompt } from "../utils/security";
import { supabase } from "./supabaseClient";

// --- Caching Helpers ---

async function getFromCache(key: string): Promise<any | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('search_cache')
      .select('result_data, grounding_chunks')
      .eq('search_key', key)
      .single();

    if (error || !data) return null;
    
    const result = data.result_data;

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

export const searchFrequencies = async (locationQuery: string, serviceTypes: ServiceType[] = ['Police', 'Fire', 'EMS']): Promise<SearchResponse> => {
  const safeLocation = sanitizeForPrompt(locationQuery);
  const sortedServices = [...serviceTypes].sort().join('-');
  const cacheKey = `loc_${safeLocation}_[${sortedServices}]`.toLowerCase().replace(/\s+/g, '');

  // Check cache first
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log(`Cache Hit for ${safeLocation}`);
    return { data: cached.data, groundingChunks: cached.groundingChunks, rawText: "Retrieved from Cache" };
  }

  console.log(`Cache Miss for ${safeLocation}. Calling API...`);

  // Call the secure serverless API route (API key stays on server)
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
  const cacheKey = `trip_${safeStart}_to_${safeEnd}_[${sortedServices}]`.toLowerCase().replace(/\s+/g, '');

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
