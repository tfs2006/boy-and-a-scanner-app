import { GoogleGenAI } from '@google/genai';

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3-flash-preview';
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
};

type GenerateAppAiContentOptions = {
  prompt: string;
  timeoutMs: number;
  allowSearchTools?: boolean;
};

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

function hasGeminiConfig(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function hasOpenRouterConfig(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
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
  const apiKey = process.env.GEMINI_API_KEY;
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
      const message = error?.message || JSON.stringify(error);
      if (!message.includes('API_KEY_INVALID') && !message.includes('400') && !message.includes('403') && !message.includes('PERMISSION_DENIED')) {
        throw error;
      }
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
  };
}

async function generateWithOpenRouter(prompt: string, timeoutMs: number): Promise<AppAiGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const model = getOpenRouterModel();
  const response = await withTimeout(
    fetch(`${process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || DEFAULT_OPENROUTER_SITE_URL,
        'X-Title': process.env.OPENROUTER_APP_NAME || DEFAULT_OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'Return only the requested JSON payload inside a json code block. Do not add prose before or after the code block.',
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
      return await generateWithGemini(options.prompt, options.timeoutMs, Boolean(options.allowSearchTools));
    }
    throw error;
  }
}