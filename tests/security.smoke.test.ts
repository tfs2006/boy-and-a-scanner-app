import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('security hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves ZIP locations without any browser AI key dependency', async () => {
    const { resolveLocationDetails } = await import('../services/locationService');

    await expect(resolveLocationDetails('84770')).resolves.toEqual({
      type: 'zip',
      standardizedName: 'ZIP 84770',
      isZip: true,
      primaryZip: '84770',
      zips: ['84770'],
    });
  });

  it('normalizes text locations locally without calling an AI client', async () => {
    const { resolveLocationDetails } = await import('../services/locationService');

    await expect(resolveLocationDetails('Washington County, UT')).resolves.toEqual({
      type: 'county',
      standardizedName: 'Washington County, UT',
      isZip: false,
      primaryZip: null,
      zips: [],
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