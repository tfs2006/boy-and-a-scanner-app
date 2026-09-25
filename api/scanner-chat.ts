import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureAppAiConfig, generateAppAiContent } from './appAiProvider.js';

const MODEL_TIMEOUT_MS = 20_000;
const FALLBACK_MODEL_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = `You are ScanPilot, the expert radio scanner programmer. Your ONLY job is to help users program their Uniden SDS100/SDS150/SDS200 scanners by providing structured channel data.

WHEN THE USER REQUESTS RADIO SYSTEMS OR CHANNELS:
- Identify the location and system type (DMR, P25, analog, etc.)
- Return a VALID JSON object ONLY, wrapped in triple backticks with "json" tag like: \`\`\`json { ... } \`\`\`
- NEVER add any other text, explanations, or markdown outside the code block
- The JSON MUST have this exact structure:
{
  "type": "DMR" | "P25" | "Analog" | "NXDN" | "Mixed",
  "location": "City, State",
  "systemName": "System/Network Name",
  "channels": [
    {
      "name": "Channel description",
      "freq": "155.4750",
      "mode": "NFM" | "FM" | "AM" | "AUTO",
      "tone": "None" | "CTCSS 100.0" | "DCS 143" | "Search",
      "serviceType": 1,
      "serviceTag": "Law Dispatch"
    }
  ]
}

IMPORTANT RULES:
- Frequencies MUST be strings in MHz format (e.g., "155.4750", "462.5625", "854.5125")
- Valid modes: NFM, FM, AM, AUTO
- Valid tones: "None", "Search", "CTCSS XXX.X", "DCS XXX" (use actual values)
- Include service type metadata for each channel:
  - serviceType = numeric RadioReference-like category id (1-255)
  - serviceTag = human label (Law Dispatch, Fire Dispatch, EMS Dispatch, Ham, Railroad, Air, Marine, etc.)
- For DMR/P25, use the control channel frequency
- If you truly cannot find data, return: {"error": "No data found for that location/system"}
- NEVER invent frequencies - if uncertain, use "error" field

REMEMBER: Always respond with ONLY the JSON code block. Never add explanations, apologies, or any other text.`;

function extractJsonObject(text: string): any | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isNoDataErrorPayload(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const msg = String((payload as any).error || '').toLowerCase();
  return msg.includes('no data found');
}

function normalizeJsonContent(content: string): string {
  const parsed = extractJsonObject(content);
  if (parsed && typeof parsed === 'object') {
    return JSON.stringify(parsed);
  }

  return JSON.stringify({
    error: 'AI returned an invalid response format. Please retry your request.',
  });
}

function sanitizeMessage(input: unknown): { role: 'user' | 'assistant'; content: string } | null {
  if (!input || typeof input !== 'object') return null;
  const rawRole = (input as any).role;
  const role: 'user' | 'assistant' = rawRole === 'assistant' ? 'assistant' : 'user';
  const content = String((input as any).content || '').slice(0, 8_000).trim();
  if (!content) return null;
  return { role, content };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = process.env.SCANNER_COMPANION_ORIGIN?.trim() || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    ensureAppAiConfig();
  } catch (error: any) {
    console.error(error?.message || 'No AI provider configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const safeMessages = Array.isArray(body?.messages)
      ? body.messages
          .map(sanitizeMessage)
          .filter(Boolean)
          .slice(0, 8) as Array<{ role: 'user' | 'assistant'; content: string }>
      : [];

    if (safeMessages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const transcript = safeMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const prompt = `${SYSTEM_PROMPT}\n\nConversation:\n${transcript}`;

    let aiMeta = await generateAppAiContent({
      prompt,
      timeoutMs: MODEL_TIMEOUT_MS,
      allowSearchTools: true,
    });

    let content = aiMeta.text || '{}';

    const parsed = extractJsonObject(content);
    if (isNoDataErrorPayload(parsed)) {
      const fallbackPrompt = `${SYSTEM_PROMPT}

Conversation:
${transcript}

The previous attempt returned {"error":"No data found for that location/system"}.
Retry with this fallback rule:
- If exact named network details are not available, return a practical starter channel set for the requested band/system in that area.
- For HAM 2m requests, include at least the national calling/simplex channel and any widely-used local 2m repeater/control frequencies you can confidently provide.
- Do not return an error object unless the request is unrelated to scanner channel programming.`;

      aiMeta = await generateAppAiContent({
        prompt: fallbackPrompt,
        timeoutMs: FALLBACK_MODEL_TIMEOUT_MS,
        allowSearchTools: true,
      });
      content = aiMeta.text || '{}';
    }

    content = normalizeJsonContent(content);

    return res.status(200).json({
      content,
      aiMeta: {
        provider: aiMeta.provider,
        model: aiMeta.model,
        fallbackUsed: aiMeta.fallbackUsed,
        fallbackFrom: aiMeta.fallbackFrom,
        usedSearchTools: aiMeta.usedSearchTools,
      },
    });
  } catch (error: any) {
    console.error('scanner-chat error:', error);
    return res.status(500).json({ error: 'Unable to complete scanner chat request.' });
  }
}