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

  it('requests structured JSON output from OpenRouter models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"source":"AI","locationName":"Bagdad, KY","agencies":[],"trunkedSystems":[]}',
            },
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    process.env.APP_AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.OPENROUTER_APP_MODEL = 'deepseek/deepseek-v4-flash';
    delete process.env.GEMINI_API_KEY;

    const { generateAppAiContent } = await import('../api/appAiProvider');

    const result = await generateAppAiContent({
      prompt: 'Find frequencies for 40003',
      timeoutMs: 1000,
      allowSearchTools: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload).toEqual(expect.objectContaining({
      model: 'deepseek/deepseek-v4-flash',
      temperature: 0,
      response_format: { type: 'json_object' },
    }));
    expect(payload.messages[0].content).toContain('Return only valid JSON');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.text).toContain('Bagdad, KY');
  });

  it('falls back to a secondary OpenRouter model when the primary model returns malformed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"source":"AI","locationName":"Bagdad, KY","agencies":["broken"',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"source":"AI","locationName":"Bagdad, KY","agencies":[],"trunkedSystems":[]}',
              },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    process.env.APP_AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    process.env.OPENROUTER_APP_MODEL = 'deepseek/deepseek-v4-flash:free';
    process.env.OPENROUTER_APP_FALLBACK_MODEL = 'deepseek/deepseek-v4-flash';
    delete process.env.GEMINI_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { generateAppAiContent } = await import('../api/appAiProvider');

    const result = await generateAppAiContent({
      prompt: 'Find frequencies for 40003',
      timeoutMs: 1000,
      allowSearchTools: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstPayload.model).toBe('deepseek/deepseek-v4-flash:free');
    expect(secondPayload.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.fallbackUsed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'OpenRouter model deepseek/deepseek-v4-flash:free failed. Retrying with fallback model deepseek/deepseek-v4-flash.',
      expect.any(Error)
    );
  });
});