import { sanitizeForPrompt } from '../utils/security';

export interface ResolvedLocation {
    type: 'zip' | 'county' | 'city' | 'unknown';
    standardizedName: string;
    canonicalName: string;
    canonicalKey: string;
    searchLabel: string;
    isZip: boolean;
    primaryZip: string | null;
    city: string | null;
    county: string | null;
    stateCode: string | null;
    zips: string[];
    aliases: string[];
    coords?: { lat: number; lng: number };
}

type ResolverResponse = {
    resolved?: Partial<ResolvedLocation> & {
        aliases?: string[];
    };
};

const LOCATION_RESOLVE_TIMEOUT_MS = 12_000;

function createRequestSignal(timeoutMs: number, signal?: AbortSignal) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    const handleAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', handleAbort, { once: true });
        }
    }

    return {
        signal: controller.signal,
        didTimeout: () => controller.signal.aborted && !signal?.aborted,
        cleanup: () => {
            window.clearTimeout(timeoutId);
            if (signal) signal.removeEventListener('abort', handleAbort);
        },
    };
}

function normalizeCountyName(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.replace(/\s+county$/i, '').trim();
    return trimmed || null;
}

function normalizeCityName(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    return value.trim() || null;
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'unknown';
}

export function createLegacyLocationCacheKey(query: string): string {
    return `v6_loc_${sanitizeForPrompt(query)}`.toLowerCase().replace(/\s+/g, '');
}

function createCanonicalLocationCacheKey(county: string | null, city: string | null, stateCode: string | null, primaryZip: string | null, fallbackLabel: string): string {
    if (county && stateCode) {
        return `v7_loc_county_${slugify(county)}_${stateCode.toLowerCase()}`;
    }
    if (city && stateCode) {
        return `v7_loc_city_${slugify(city)}_${stateCode.toLowerCase()}`;
    }
    if (primaryZip) {
        return `v7_loc_zip_${primaryZip}`;
    }
    return `v7_loc_query_${slugify(fallbackLabel)}`;
}

function buildSearchLabel(city: string | null, county: string | null, stateCode: string | null, primaryZip: string | null, fallback: string): string {
    const parts: string[] = [];
    if (city && stateCode) parts.push(`${city}, ${stateCode}`);
    if (county && stateCode) parts.push(`${county} County, ${stateCode}`);
    if (primaryZip) parts.push(`ZIP ${primaryZip}`);
    return parts.length > 0 ? parts.join(' | ') : fallback;
}

function buildFallbackResolution(query: string): ResolvedLocation {
    const safeQuery = sanitizeForPrompt(query);
    const zipMatch = safeQuery.match(/^(\d{5})$/);
    const type: ResolvedLocation['type'] = zipMatch
        ? 'zip'
        : /county/i.test(safeQuery)
            ? 'county'
            : safeQuery
                ? 'city'
                : 'unknown';
    const primaryZip = zipMatch ? zipMatch[1] : null;
    const standardizedName = safeQuery || 'Unknown Location';

    return {
        type,
        standardizedName,
        canonicalName: standardizedName,
        canonicalKey: createCanonicalLocationCacheKey(null, null, null, primaryZip, standardizedName),
        searchLabel: standardizedName,
        isZip: type === 'zip',
        primaryZip,
        city: null,
        county: null,
        stateCode: null,
        zips: primaryZip ? [primaryZip] : [],
        aliases: [standardizedName, ...(primaryZip ? [primaryZip] : [])],
    };
}

function normalizeResolvedLocation(query: string, payload?: Partial<ResolvedLocation> & { aliases?: string[] }): ResolvedLocation {
    const fallback = buildFallbackResolution(query);
    const city = normalizeCityName(payload?.city) ?? fallback.city;
    const county = normalizeCountyName(payload?.county) ?? fallback.county;
    const stateCode = typeof payload?.stateCode === 'string' && payload.stateCode.trim()
        ? payload.stateCode.trim().toUpperCase()
        : fallback.stateCode;
    const primaryZip = typeof payload?.primaryZip === 'string' && /^\d{5}$/.test(payload.primaryZip)
        ? payload.primaryZip
        : fallback.primaryZip;
    const type = payload?.type && ['zip', 'county', 'city', 'unknown'].includes(payload.type)
        ? payload.type
        : fallback.type;
    const standardizedName = typeof payload?.standardizedName === 'string' && payload.standardizedName.trim()
        ? payload.standardizedName.trim()
        : city && stateCode
            ? `${city}, ${stateCode}`
            : county && stateCode
                ? `${county} County, ${stateCode}`
                : fallback.standardizedName;
    const canonicalName = county && stateCode
        ? `${county} County, ${stateCode}`
        : city && stateCode
            ? `${city}, ${stateCode}`
            : standardizedName;
    const aliases = new Set<string>();
    for (const alias of payload?.aliases || []) {
        const safeAlias = sanitizeForPrompt(alias);
        if (safeAlias) aliases.add(safeAlias);
    }
    aliases.add(standardizedName);
    aliases.add(canonicalName);
    aliases.add(sanitizeForPrompt(query));
    if (city && stateCode) aliases.add(`${city}, ${stateCode}`);
    if (county && stateCode) aliases.add(`${county} County, ${stateCode}`);
    if (primaryZip) aliases.add(primaryZip);

    return {
        type,
        standardizedName,
        canonicalName,
        canonicalKey: createCanonicalLocationCacheKey(county, city, stateCode, primaryZip, canonicalName),
        searchLabel: buildSearchLabel(city, county, stateCode, primaryZip, standardizedName),
        isZip: type === 'zip',
        primaryZip,
        city,
        county,
        stateCode,
        zips: primaryZip ? [primaryZip] : [],
        aliases: Array.from(aliases).filter(Boolean),
        coords: payload?.coords,
    };
}

export function createLocationCacheKeys(query: string, resolvedLocation: ResolvedLocation): string[] {
    const keys = new Set<string>();
    keys.add(resolvedLocation.canonicalKey);
    keys.add(createLegacyLocationCacheKey(query));
    for (const alias of resolvedLocation.aliases) {
        keys.add(createLegacyLocationCacheKey(alias));
    }
    return Array.from(keys);
}

export const resolveLocationDetails = async (query: string, signal?: AbortSignal): Promise<ResolvedLocation> => {
    const safeQuery = sanitizeForPrompt(query);
    const fallback = buildFallbackResolution(safeQuery);
    if (!safeQuery) return fallback;

    const { signal: requestSignal, didTimeout, cleanup } = createRequestSignal(LOCATION_RESOLVE_TIMEOUT_MS, signal);

    try {
        const response = await fetch('/api/location-resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: requestSignal,
            body: JSON.stringify({ query: safeQuery }),
        });

        if (!response.ok) {
            return fallback;
        }

        const json = await response.json() as ResolverResponse;
        return normalizeResolvedLocation(safeQuery, json.resolved);
    } catch (error: any) {
        if (didTimeout()) {
            console.warn('Location resolution timed out for query:', safeQuery);
        } else if (error?.name !== 'AbortError') {
            console.warn('Location resolution fallback used for query:', safeQuery, error);
        }
        return fallback;
    } finally {
        cleanup();
    }
};
