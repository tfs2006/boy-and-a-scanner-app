import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('security hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves ZIP locations without any browser AI key dependency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resolved: {
          type: 'zip',
          standardizedName: 'St George, UT',
          primaryZip: '84770',
          city: 'St George',
          county: 'Washington',
          stateCode: 'UT',
          aliases: ['84770', 'St George, UT', 'Washington County, UT'],
        },
      }),
    }));

    const { resolveLocationDetails } = await import('../services/locationService');

    await expect(resolveLocationDetails('84770')).resolves.toMatchObject({
      type: 'zip',
      standardizedName: 'St George, UT',
      canonicalName: 'Washington County, UT',
      canonicalKey: 'v7_loc_county_washington_ut',
      searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
      isZip: true,
      primaryZip: '84770',
      city: 'St George',
      county: 'Washington',
      stateCode: 'UT',
      zips: ['84770'],
    });
  });

  it('falls back safely when the location resolver is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { resolveLocationDetails } = await import('../services/locationService');

    await expect(resolveLocationDetails('Washington County, UT')).resolves.toEqual({
      type: 'county',
      standardizedName: 'Washington County, UT',
      canonicalName: 'Washington County, UT',
      canonicalKey: 'v7_loc_query_washington_county_ut',
      searchLabel: 'Washington County, UT',
      isZip: false,
      primaryZip: null,
      city: null,
      county: null,
      stateCode: null,
      zips: [],
      aliases: ['Washington County, UT'],
    });
  });

  it('times out hung RR requests', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) {
        return;
      }

      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';

      if (signal.aborted) {
        reject(abortError);
        return;
      }

      signal.addEventListener('abort', () => reject(abortError), { once: true });
    })));

    const { fetchFromRadioReference } = await import('../services/rrApi');
    const promise = fetchFromRadioReference('12345', { username: 'demo', password: 'secret' }, ['Police']);
    const expectation = expect(promise).rejects.toThrow('RadioReference request timed out');

    await vi.advanceTimersByTimeAsync(45_000);

    await expectation;
  });
});