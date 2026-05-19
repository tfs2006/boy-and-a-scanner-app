import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('appAiProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('retries Gemini without search tools when the tool-backed request fails', async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(new Error('503 search tool unavailable'))
      .mockResolvedValueOnce({
        text: '```json\n{"source":"AI","locationName":"Bagdad, KY","agencies":[],"trunkedSystems":[]}\n```',
        candidates: [],
      });

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = { generateContent };
      },
    }));

    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.APP_AI_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { generateAppAiContent } = await import('../api/appAiProvider');

    const result = await generateAppAiContent({
      prompt: 'Find frequencies for 40003',
      timeoutMs: 1000,
      allowSearchTools: true,
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: 'gemini-2.5-flash',
      config: { tools: [{ googleSearch: {} }] },
    }));
    expect(generateContent.mock.calls[1][0]).toEqual(expect.objectContaining({
      model: 'gemini-2.5-flash',
      contents: 'Find frequencies for 40003',
    }));
    expect(generateContent.mock.calls[1][0].config).toBeUndefined();
    expect(result.provider).toBe('gemini');
    expect(result.usedSearchTools).toBe(false);
    expect(result.text).toContain('Bagdad, KY');
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini search-tool request failed. Retrying without tools.',
      '503 search tool unavailable'
    );
  });

  it('falls back from Gemini to OpenRouter when Gemini fails entirely', async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error('503 gemini unavailable'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n{"source":"AI","locationName":"Bagdad, KY","agencies":[],"trunkedSystems":[]}\n```',
            },
          },
        ],
      }),
    });

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = { generateContent };
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    process.env.APP_AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { generateAppAiContent } = await import('../api/appAiProvider');

    const result = await generateAppAiContent({
      prompt: 'Find frequencies for 40003',
      timeoutMs: 1000,
      allowSearchTools: true,
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openrouter');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackFrom).toBe('gemini');
    expect(result.text).toContain('Bagdad, KY');
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini request failed. Falling back to OpenRouter for this request.',
      expect.any(Error)
    );
  });
});