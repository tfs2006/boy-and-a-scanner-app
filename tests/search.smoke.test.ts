import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('search smoke', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns cached search results without hitting network fetch', async () => {
    const cachedResult = {
      source: 'AI',
      locationName: 'Test County, TS',
      summary: 'Cached result',
      agencies: [
        {
          name: 'Test Sheriff',
          category: 'Police',
          frequencies: [{ freq: '155.100', description: 'Dispatch', mode: 'FM', tag: 'Dispatch' }],
        },
      ],
      trunkedSystems: [],
    };

    const single = vi.fn().mockResolvedValue({
      data: { result_data: cachedResult, grounding_chunks: [{ web: { uri: 'https://example.com', title: 'Source' } }] },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    vi.doMock('../services/supabaseClient', () => ({
      supabase: { from },
    }));
    vi.doMock('../services/rrApi', () => ({
      fetchFromRadioReference: vi.fn(),
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { searchFrequencies } = await import('../services/geminiService');
    const response = await searchFrequencies('Test County', ['Police']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.data?.source).toBe('Cache');
    expect(response.data?.agencies).toHaveLength(1);
    expect(response.groundingChunks).toHaveLength(1);
  });
});