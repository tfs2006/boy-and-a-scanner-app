import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult, TripResult } from '../types';

const rrResult: ScanResult = {
  source: 'API',
  locationName: 'Test County, TS',
  summary: 'RR data',
  agencies: [
    {
      name: 'County Sheriff',
      category: 'Police Dispatch',
      frequencies: [
        { freq: '155.5500', description: 'Dispatch', mode: 'FM', tag: 'Dispatch' },
      ],
    },
  ],
  trunkedSystems: [
    {
      name: 'County P25',
      type: 'P25 Phase I',
      location: 'North Site',
      frequencies: [{ freq: '851.0125', use: 'Control' }],
      talkgroups: [
        { dec: '101', mode: 'D', alphaTag: 'Sheriff Disp', description: 'Law Dispatch', tag: 'Law Dispatch' },
      ],
    },
  ],
};

const aiResult: ScanResult = {
  source: 'AI',
  locationName: 'Test County, TS',
  summary: 'AI data',
  agencies: [
    {
      name: 'County Sheriff',
      category: 'Police Dispatch',
      frequencies: [
        { freq: '155.5500', description: 'Dispatch', mode: 'FM', tag: 'Dispatch' },
      ],
    },
    {
      name: 'County Fire',
      category: 'Fire Dispatch',
      frequencies: [
        { freq: '154.4300', description: 'Fire Dispatch', mode: 'FM', tag: 'Fire' },
      ],
    },
  ],
  trunkedSystems: [
    {
      name: 'Metro DMR',
      type: 'DMR Trunked',
      location: 'South Site',
      frequencies: [{ freq: '452.1250', use: 'Control' }],
      talkgroups: [
        { dec: '201', mode: 'T', alphaTag: 'Police Tac', description: 'Law Tactical', tag: 'Law Tac' },
        { dec: '202', mode: 'T', alphaTag: 'Fire Ops', description: 'Fireground', tag: 'Fire-Tac' },
      ],
    },
  ],
};

describe('geminiService hybrid flows', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('merges RR and AI data, keeps RR authoritative, and filters by requested services', async () => {
    vi.doMock('../services/supabaseClient', () => ({ supabase: null }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn().mockResolvedValue(structuredClone(rrResult)),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: structuredClone(aiResult),
        groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
        rawText: 'AI Results',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police'], { username: 'demo', password: 'secret' });

    expect(response.data?.source).toBe('API');
    expect(response.data?.agencies.map((agency) => agency.name)).toEqual(['County Sheriff']);
    expect(response.data?.trunkedSystems.map((system) => system.name)).toEqual(['County P25', 'Metro DMR']);

    const countyP25 = response.data?.trunkedSystems.find((system) => system.name === 'County P25');
    const metroDmr = response.data?.trunkedSystems.find((system) => system.name === 'Metro DMR');

    expect(countyP25?.talkgroups).toHaveLength(1);
    expect(countyP25?.talkgroups[0].tagType).toBe('dispatch');
    expect(metroDmr?.talkgroups).toHaveLength(1);
    expect(metroDmr?.talkgroups[0].alphaTag).toBe('Police Tac');
    expect(metroDmr?.talkgroups[0].tagType).toBe('tactical');

    const fetchFromRadioReference = (await import('../services/rrApi')).fetchFromRadioReference as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFromRadioReference).toHaveBeenCalledWith('84770', { username: 'demo', password: 'secret' }, expect.any(Array), undefined);
    expect(fetchMock).toHaveBeenCalledWith('/api/search', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Washington County, UT'),
    }));
  });

  it('reuses legacy ZIP cache entries for equivalent city-state searches', async () => {
    const single = vi.fn((key: string) => Promise.resolve({
      data: key === 'v6_loc_84770'
        ? {
            result_data: structuredClone(aiResult),
            grounding_chunks: [{ web: { uri: 'https://example.com/cache', title: 'Cache' } }],
          }
        : null,
      error: key === 'v6_loc_84770' ? null : { message: 'Not found' },
    }));
    const eq = vi.fn((_: string, key: string) => ({ single: () => single(key) }));
    const select = vi.fn().mockReturnValue({ eq });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ select, upsert });

    vi.doMock('../services/supabaseClient', () => ({ supabase: { from } }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn(),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police']);

    expect(response.data?.source).toBe('Cache');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(single).toHaveBeenCalledWith('v7_loc_county_washington_ut');
    expect(single).toHaveBeenCalledWith('v6_loc_st.george,ut');
    expect(single).toHaveBeenCalledWith('v6_loc_84770');
  });

  it('uses cached AI data as a supplement while fetching fresh RadioReference data', async () => {
    const single = vi.fn((key: string) => Promise.resolve({
      data: key === 'v7_loc_county_washington_ut'
        ? {
            result_data: structuredClone(aiResult),
            grounding_chunks: [{ web: { uri: 'https://example.com/cache', title: 'Cache' } }],
          }
        : null,
      error: key === 'v7_loc_county_washington_ut' ? null : { message: 'Not found' },
    }));
    const eq = vi.fn((_: string, key: string) => ({ single: () => single(key) }));
    const select = vi.fn().mockReturnValue({ eq });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ select, upsert });

    vi.doMock('../services/supabaseClient', () => ({ supabase: { from } }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn().mockResolvedValue(structuredClone(rrResult)),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police'], { username: 'demo', password: 'secret' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.data?.source).toBe('API');
    expect(response.searchMeta?.refreshedWithRadioReference).toBe(true);
    expect(response.searchMeta?.usedCachedAiSupplement).toBe(true);
    expect(response.data?.agencies.map((agency) => agency.name)).toEqual(['County Sheriff']);
    expect(response.data?.trunkedSystems.map((system) => system.name)).toEqual(['County P25', 'Metro DMR']);
    expect(response.rawText).toBe('Merged Hybrid Results (RR + cached AI)');

    const fetchFromRadioReference = (await import('../services/rrApi')).fetchFromRadioReference as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFromRadioReference).toHaveBeenCalledWith('84770', { username: 'demo', password: 'secret' }, expect.any(Array), undefined);
  });

  it('reuses authoritative RR cache immediately even when RR credentials are present', async () => {
    const cachedRrResult = structuredClone(rrResult);
    const single = vi.fn((key: string) => Promise.resolve({
      data: key === 'v7_loc_county_washington_ut'
        ? {
            result_data: cachedRrResult,
            grounding_chunks: [{ web: { uri: 'https://example.com/rr-cache', title: 'RR Cache' } }],
          }
        : null,
      error: key === 'v7_loc_county_washington_ut' ? null : { message: 'Not found' },
    }));
    const eq = vi.fn((_: string, key: string) => ({ single: () => single(key) }));
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.doMock('../services/supabaseClient', () => ({ supabase: { from } }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn(),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police'], { username: 'demo', password: 'secret' });

    expect(response.data?.source).toBe('API');
    expect(response.searchMeta?.usedAuthoritativeCache).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const fetchFromRadioReference = (await import('../services/rrApi')).fetchFromRadioReference as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFromRadioReference).not.toHaveBeenCalled();
  });

  it('bypasses cache reads during a manual authoritative refresh', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        result_data: structuredClone(rrResult),
        grounding_chunks: [{ web: { uri: 'https://example.com/rr-cache', title: 'RR Cache' } }],
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ select, upsert });

    vi.doMock('../services/supabaseClient', () => ({ supabase: { from } }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn().mockResolvedValue(structuredClone(rrResult)),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: structuredClone(aiResult),
        groundingChunks: [{ web: { uri: 'https://example.com/live-ai', title: 'Live AI' } }],
        rawText: 'AI Results',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police'], { username: 'demo', password: 'secret' }, undefined, { bypassCache: true });

    expect(single).not.toHaveBeenCalled();
    expect(response.data?.source).toBe('API');
    expect(response.searchMeta?.bypassedCache).toBe(true);

    const fetchFromRadioReference = (await import('../services/rrApi')).fetchFromRadioReference as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFromRadioReference).toHaveBeenCalledWith('84770', { username: 'demo', password: 'secret' }, expect.any(Array), undefined);
  });

  it('automatically refreshes authoritative RR cache when it is older than the configured threshold', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        result_data: structuredClone(rrResult),
        grounding_chunks: [{ web: { uri: 'https://example.com/rr-cache', title: 'RR Cache' } }],
        updated_at: '2024-01-01T00:00:00.000Z',
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ select, upsert });

    vi.doMock('../services/supabaseClient', () => ({ supabase: { from } }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn().mockResolvedValue(structuredClone(rrResult)),
    }));
    vi.doMock('../services/locationService', () => ({
      resolveLocationDetails: vi.fn().mockResolvedValue({
        type: 'city',
        standardizedName: 'St George, UT',
        canonicalName: 'Washington County, UT',
        canonicalKey: 'v7_loc_county_washington_ut',
        searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
        isZip: false,
        primaryZip: '84770',
        city: 'St George',
        county: 'Washington',
        stateCode: 'UT',
        zips: ['84770'],
        aliases: ['St George, UT', 'Washington County, UT', '84770'],
      }),
      createLocationCacheKeys: vi.fn().mockReturnValue(['v7_loc_county_washington_ut', 'v6_loc_st.george,ut', 'v6_loc_84770']),
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: structuredClone(aiResult),
        groundingChunks: [{ web: { uri: 'https://example.com/live-ai', title: 'Live AI' } }],
        rawText: 'AI Results',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('St. George, UT', ['Police'], { username: 'demo', password: 'secret' }, undefined, { maxAuthoritativeCacheAgeMs: 60_000 });

    expect(response.data?.source).toBe('API');
    expect(response.searchMeta?.autoBypassedStaleAuthoritativeCache).toBe(true);
    expect(response.searchMeta?.lastAuthoritativeRefreshAt).toBeTruthy();

    const fetchFromRadioReference = (await import('../services/rrApi')).fetchFromRadioReference as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFromRadioReference).toHaveBeenCalledWith('84770', { username: 'demo', password: 'secret' }, expect.any(Array), undefined);
  });

  it('filters trip results without mutating the original trip payload', async () => {
    vi.doMock('../services/supabaseClient', () => ({ supabase: null }));

    const { filterTripByServices } = await import('../services/geminiService');

    const trip: TripResult = {
      startLocation: 'Start',
      endLocation: 'End',
      locations: [
        {
          locationName: 'Stop 1',
          data: {
            source: 'AI',
            locationName: 'Stop 1',
            summary: 'Mixed services',
            agencies: [
              {
                name: 'Police Dispatch',
                category: 'Police',
                frequencies: [{ freq: '155.1000', description: 'Dispatch', mode: 'FM', tag: 'Law' }],
              },
              {
                name: 'County Fire',
                category: 'Fire',
                frequencies: [{ freq: '154.4300', description: 'Dispatch', mode: 'FM', tag: 'Fire' }],
              },
            ],
            trunkedSystems: [
              {
                name: 'Regional System',
                type: 'P25 Phase II',
                location: 'Main',
                frequencies: [{ freq: '851.0000', use: 'Control' }],
                talkgroups: [
                  { dec: '1', mode: 'D', alphaTag: 'PD Disp', description: 'Law Dispatch', tag: 'Law Dispatch' },
                  { dec: '2', mode: 'D', alphaTag: 'Fire Ops', description: 'Fireground', tag: 'Fire-Tac' },
                ],
              },
            ],
          },
        },
      ],
    };

    const filtered = filterTripByServices(trip, ['Fire']);

    expect(filtered?.locations[0].data.agencies.map((agency) => agency.name)).toEqual(['County Fire']);
    expect(filtered?.locations[0].data.trunkedSystems[0].talkgroups.map((talkgroup) => talkgroup.alphaTag)).toEqual(['Fire Ops']);

    expect(trip.locations[0].data.agencies.map((agency) => agency.name)).toEqual(['Police Dispatch', 'County Fire']);
    expect(trip.locations[0].data.trunkedSystems[0].talkgroups).toHaveLength(2);
  });
});