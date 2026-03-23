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

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: structuredClone(aiResult),
        groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
        rawText: 'AI Results',
      }),
    }));

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('12345', ['Police'], { username: 'demo', password: 'secret' });

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