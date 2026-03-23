import type { VercelRequest, VercelResponse } from '@vercel/node';

const REQUEST_TIMEOUT_MS = 12_000;
const CENSUS_BENCHMARK = 'Public_AR_Current';
const CENSUS_VINTAGE = 'Current_Current';

const STATE_ALIASES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC'
};

type ResolverPayload = {
  type: 'zip' | 'county' | 'city' | 'unknown';
  standardizedName: string;
  primaryZip: string | null;
  city: string | null;
  county: string | null;
  stateCode: string | null;
  coords?: { lat: number; lng: number };
  aliases: string[];
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function sanitizeQuery(input: string): string {
  return String(input || '').replace(/[^a-zA-Z0-9\s,.-]/g, '').trim().slice(0, 100);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeCountyName(value: string | null | undefined): string | null {
  if (!value) return null;
  return titleCase(value.replace(/\s+county$/i, '').trim()) || null;
}

function normalizeCityName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^(st|ste)\.?$/i.test(part)) return part.replace('.', '').toUpperCase() === 'STE' ? 'Ste' : 'St';
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ') || null;
}

function parseStateCode(query: string): { stateCode: string | null; locality: string } {
  const trimmed = query.trim();
  if (!trimmed) return { stateCode: null, locality: '' };

  const commaParts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const tail = commaParts.length > 1 ? commaParts[commaParts.length - 1] : trimmed.split(/\s+/).slice(-2).join(' ');
  const tailLower = tail.toLowerCase();
  const compactTail = tail.trim().toUpperCase();

  if (/^[A-Z]{2}$/.test(compactTail)) {
    const locality = commaParts.length > 1
      ? commaParts.slice(0, -1).join(', ').trim()
      : trimmed.replace(new RegExp(`${compactTail}$`, 'i'), '').replace(/[\s,]+$/, '').trim();
    return { stateCode: compactTail, locality };
  }

  const matchedState = Object.entries(STATE_ALIASES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([name]) => trimmed.toLowerCase().endsWith(name));

  if (matchedState) {
    const [stateName, stateCode] = matchedState;
    const locality = trimmed.slice(0, trimmed.length - stateName.length).replace(/[\s,]+$/, '').trim();
    return { stateCode, locality };
  }

  if (commaParts.length > 1) {
    const maybeState = tailLower.replace(/\./g, '');
    if (STATE_ALIASES[maybeState]) {
      return { stateCode: STATE_ALIASES[maybeState], locality: commaParts.slice(0, -1).join(', ').trim() };
    }
  }

  return { stateCode: null, locality: trimmed };
}

function buildFallback(query: string): ResolverPayload {
  const safeQuery = sanitizeQuery(query);
  const zipMatch = safeQuery.match(/^\d{5}$/);
  if (zipMatch) {
    return {
      type: 'zip',
      standardizedName: zipMatch[0],
      primaryZip: zipMatch[0],
      city: null,
      county: null,
      stateCode: null,
      aliases: [zipMatch[0]],
    };
  }

  const { stateCode, locality } = parseStateCode(safeQuery);
  const isCounty = /county/i.test(safeQuery);
  const county = isCounty ? normalizeCountyName(locality || safeQuery) : null;
  const city = !isCounty ? normalizeCityName(locality || safeQuery) : null;
  const standardizedName = county && stateCode
    ? `${county} County, ${stateCode}`
    : city && stateCode
      ? `${city}, ${stateCode}`
      : safeQuery;

  const aliases = [safeQuery];
  if (city && stateCode) aliases.push(`${city}, ${stateCode}`);
  if (county && stateCode) aliases.push(`${county} County, ${stateCode}`);

  return {
    type: isCounty ? 'county' : (city ? 'city' : 'unknown'),
    standardizedName,
    primaryZip: null,
    city,
    county,
    stateCode,
    aliases,
  };
}

async function fetchJson(url: string) {
  const response = await withTimeout(fetch(url), REQUEST_TIMEOUT_MS, 'Location resolve timed out');
  if (!response.ok) {
    throw new Error(`Location resolver upstream failed (${response.status})`);
  }
  return response.json();
}

async function fetchCountyFromCoords(lat: number, lng: number): Promise<string | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}&benchmark=${CENSUS_BENCHMARK}&vintage=${CENSUS_VINTAGE}&format=json`;
  const json = await fetchJson(url);
  const counties = json?.result?.geographies?.Counties;
  if (!Array.isArray(counties) || counties.length === 0) return null;
  return normalizeCountyName(counties[0]?.NAME);
}

async function resolveZip(zip: string): Promise<Partial<ResolverPayload>> {
  const json = await fetchJson(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
  const place = Array.isArray(json?.places) ? json.places[0] : null;
  if (!place) return { primaryZip: zip };

  const lat = Number(place.latitude);
  const lng = Number(place.longitude);
  let county: string | null = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      county = await fetchCountyFromCoords(lat, lng);
    } catch {
      county = null;
    }
  }

  const city = normalizeCityName(place['place name']);
  const stateCode = typeof place['state abbreviation'] === 'string' ? place['state abbreviation'].trim().toUpperCase() : null;
  const standardizedName = city && stateCode ? `${city}, ${stateCode}` : zip;
  const aliases = [zip];
  if (city && stateCode) aliases.push(`${city}, ${stateCode}`);
  if (county && stateCode) aliases.push(`${county} County, ${stateCode}`);

  return {
    type: 'zip',
    standardizedName,
    primaryZip: zip,
    city,
    county,
    stateCode,
    coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    aliases,
  };
}

async function resolveText(query: string): Promise<Partial<ResolverPayload>> {
  const json = await fetchJson(
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(query)}&benchmark=${CENSUS_BENCHMARK}&vintage=${CENSUS_VINTAGE}&format=json`
  );
  const match = json?.result?.addressMatches?.[0];
  if (!match) return {};

  const components = match.addressComponents || {};
  const countyGeo = Array.isArray(match?.geographies?.Counties) ? match.geographies.Counties[0] : null;
  const city = normalizeCityName(components.city || components.placeName || components.fromAddress);
  const county = normalizeCountyName(countyGeo?.NAME || components.county);
  const stateCode = typeof components.state === 'string' ? components.state.trim().toUpperCase() : null;
  const primaryZip = typeof components.zip === 'string' && /^\d{5}$/.test(components.zip) ? components.zip : null;
  const lat = Number(match.coordinates?.y);
  const lng = Number(match.coordinates?.x);
  const standardizedName = county && stateCode
    ? `${county} County, ${stateCode}`
    : city && stateCode
      ? `${city}, ${stateCode}`
      : query;

  const aliases = [query];
  if (city && stateCode) aliases.push(`${city}, ${stateCode}`);
  if (county && stateCode) aliases.push(`${county} County, ${stateCode}`);
  if (primaryZip) aliases.push(primaryZip);

  return {
    standardizedName,
    primaryZip,
    city,
    county,
    stateCode,
    coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    aliases,
  };
}

function mergeResolved(base: ResolverPayload, patch: Partial<ResolverPayload>): ResolverPayload {
  const aliases = new Set<string>([...base.aliases, ...(patch.aliases || [])].filter(Boolean));
  return {
    ...base,
    ...patch,
    aliases: Array.from(aliases),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const safeQuery = sanitizeQuery(req.body?.query || '');
    if (!safeQuery) {
      return res.status(400).json({ error: 'Missing location query' });
    }

    let resolved = buildFallback(safeQuery);

    try {
      if (/^\d{5}$/.test(safeQuery)) {
        resolved = mergeResolved(resolved, await resolveZip(safeQuery));
      } else {
        resolved = mergeResolved(resolved, await resolveText(safeQuery));
      }
    } catch (error) {
      console.warn('Location resolution fallback used for query:', safeQuery, error);
    }

    return res.status(200).json({ resolved });
  } catch (error: any) {
    console.error('Location resolve API error:', error);
    return res.status(500).json({ error: 'Unable to resolve location at this time.' });
  }
}