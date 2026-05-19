import { GoogleGenAI } from '@google/genai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_SITE_URL = 'https://www.boyandascanner.com';
const DEFAULT_OPENROUTER_APP_NAME = 'Boy & A Scanner App';

export type AppAiProvider = 'gemini' | 'openrouter';

export type AppAiGenerationResult = {
  text: string;
  groundingChunks: unknown[];
  provider: AppAiProvider;
  model: string;
  usedSearchTools: boolean;
  fallbackUsed: boolean;
  fallbackFrom?: AppAiProvider;
};

type GenerateAppAiContentOptions = {
  prompt: string;
  timeoutMs: number;
  allowSearchTools?: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function shouldRetryGeminiWithoutSearchTools(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  // Hard auth/config failures will not improve if we immediately retry the same
  // model without Google Search tools enabled.
  if (message.includes('api_key_invalid')) return false;
  if (message.includes('permission_denied')) return false;
  if (message.includes('unauthorized')) return false;
  if (message.includes('invalid api key')) return false;
  if (message.includes('gemini_api_key is not configured')) return false;

  return true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function getPreferredProvider(): AppAiProvider {
  const raw = (process.env.APP_AI_PROVIDER || 'gemini').trim().toLowerCase();
  return raw === 'openrouter' ? 'openrouter' : 'gemini';
}

function getGeminiModel(): string {
  return process.env.GEMINI_APP_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

function getOpenRouterModel(): string {
  return process.env.OPENROUTER_APP_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

function getOpenRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function hasGeminiConfig(): boolean {
  return Boolean(getGeminiApiKey());
}

function hasOpenRouterConfig(): boolean {
  return Boolean(getOpenRouterApiKey());
}

export function getActiveAppAiProvider(): AppAiProvider {
  const preferred = getPreferredProvider();
  if (preferred === 'openrouter' && hasOpenRouterConfig()) return 'openrouter';
  if (preferred === 'gemini' && hasGeminiConfig()) return 'gemini';
  if (hasOpenRouterConfig()) return 'openrouter';
  return 'gemini';
}

export function ensureAppAiConfig(): void {
  if (!hasGeminiConfig() && !hasOpenRouterConfig()) {
    throw new Error('No AI provider is configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.');
  }
}

async function generateWithGemini(prompt: string, timeoutMs: number, allowSearchTools: boolean): Promise<AppAiGenerationResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = getGeminiModel();
  let response: any;
  let usedSearchTools = false;

  if (allowSearchTools) {
    try {
      usedSearchTools = true;
      response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        }),
        timeoutMs,
        'AI request timed out'
      );
    } catch (error: any) {
      if (!shouldRetryGeminiWithoutSearchTools(error)) {
        throw error;
      }

      console.warn('Gemini search-tool request failed. Retrying without tools.', getErrorMessage(error));
      usedSearchTools = false;
      response = undefined;
    }
  }

  if (!response) {
    response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: prompt,
      }),
      timeoutMs,
      'AI request timed out'
    );
  }

  return {
    text: response?.text || '{}',
    groundingChunks: usedSearchTools ? (response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []) : [],
    provider: 'gemini',
    model,
    usedSearchTools,
    fallbackUsed: false,
  };
}

async function generateWithOpenRouter(prompt: string, timeoutMs: number): Promise<AppAiGenerationResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const model = getOpenRouterModel();
  const response = await withTimeout(
    fetch(`${process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL?.trim() || DEFAULT_OPENROUTER_SITE_URL,
        'X-Title': process.env.OPENROUTER_APP_NAME?.trim() || DEFAULT_OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: 'Return only valid JSON for the requested payload. Do not wrap the JSON in markdown fences or add prose before or after it.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    }),
    timeoutMs,
    'AI request timed out'
  );

  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenRouter request failed (${response.status})`);
  }

  return {
    text: payload?.choices?.[0]?.message?.content || '{}',
    groundingChunks: [],
    provider: 'openrouter',
    model,
    usedSearchTools: false,
    fallbackUsed: false,
  };
}

export async function generateAppAiContent(options: GenerateAppAiContentOptions): Promise<AppAiGenerationResult> {
  const provider = getActiveAppAiProvider();

  try {
    if (provider === 'openrouter') {
      return await generateWithOpenRouter(options.prompt, options.timeoutMs);
    }
    return await generateWithGemini(options.prompt, options.timeoutMs, Boolean(options.allowSearchTools));
  } catch (error) {
    if (provider === 'openrouter' && hasGeminiConfig()) {
      console.warn('OpenRouter request failed. Falling back to Gemini for this request.', error);
      const fallback = await generateWithGemini(options.prompt, options.timeoutMs, Boolean(options.allowSearchTools));
      return {
        ...fallback,
        fallbackUsed: true,
        fallbackFrom: 'openrouter',
      };
    }

    if (provider === 'gemini' && hasOpenRouterConfig()) {
      console.warn('Gemini request failed. Falling back to OpenRouter for this request.', error);
      const fallback = await generateWithOpenRouter(options.prompt, options.timeoutMs);
      return {
        ...fallback,
        fallbackUsed: true,
        fallbackFrom: 'gemini',
      };
    }

    throw error;
  }
}