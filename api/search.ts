import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.0-flash";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not configured in Vercel environment");
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { location, serviceTypes } = req.body;

    if (!location || !serviceTypes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Sanitize input
    const safeLocation = String(location).replace(/[^a-zA-Z0-9\s,.-]/g, "").trim().slice(0, 100);
    const safeServices = Array.isArray(serviceTypes) ? serviceTypes.slice(0, 20) : ['Police', 'Fire', 'EMS'];

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
    You are an intelligent interface for the RadioReference Database.
    Task: Retrieve the official radio frequency data for Location: "${safeLocation}".
    IMPORTANT: If the location is a ZIP CODE, first identify the County and State.
    
    SCOPE: ${safeServices.join(', ')}.
    
    CRITICAL INCLUSION RULES:
    1. **Statewide/Regional Systems**: Include large trunked systems (e.g. UCA, AIRS, RISCON) if they cover the area.
    2. **Synonyms**: "Police" includes Sheriff, Highway Patrol. "Fire" includes Rescue.
    3. **Conventional**: Include analog frequencies.
    
    DATA EXTRACTION:
    1. **Trunked System Sites**: Identify specific sites/towers for "${safeLocation}".
    2. **Control Channels**: Extract "Freqs" (Control Channels) for that site.
    3. **Tone/NAC**: Capture PL/DPL/NAC.
    
    OUTPUT FORMAT:
    Return strictly formatted JSON inside a code block.
    \`\`\`json
    {
      "source": "AI",
      "locationName": "County, State",
      "summary": "Overview...",
      "crossRef": { "verified": true, "confidenceScore": 95, "sourcesChecked": 3, "notes": "Verified." },
      "agencies": [
        {
          "name": "Agency Name",
          "category": "Police",
          "frequencies": [ { "freq": "155.000", "description": "Dispatch", "mode": "FMN", "tag": "Dispatch", "alphaTag": "PD", "tone": "123.4", "nac": "293" } ]
        }
      ],
      "trunkedSystems": [
        {
          "name": "System Name",
          "type": "P25",
          "location": "Site Name",
          "frequencies": [ { "freq": "851.000", "use": "Control" } ],
          "talkgroups": [ { "dec": "123", "mode": "D", "alphaTag": "DISP", "description": "Dispatch", "tag": "Law Dispatch" } ]
        }
      ]
    }
    \`\`\`
  `;

    let response;
    let usedTools = true;

    try {
      response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (err: any) {
      const msg = err.message || JSON.stringify(err);
      if (msg.includes('API_KEY_INVALID') || msg.includes('400') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
        console.warn("Google Search Tool rejected. Retrying without tools...");
        usedTools = false;
        response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
        });
      } else {
        throw err;
      }
    }

    const text = response?.text || "{}";
    let data: any = null;

    // Robust JSON Parsing
    try {
      const match = text.match(/```json\n([\s\S]*?)(\n```|$)/);
      if (match && match[1]) {
        data = JSON.parse(match[1]);
      } else {
        data = JSON.parse(text);
      }
    } catch (e) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { data = JSON.parse(text.substring(start, end + 1)); } catch (e2) {}
      }
    }

    if (data) {
      data.source = 'AI';
      if (!Array.isArray(data.agencies)) data.agencies = [];
      if (!Array.isArray(data.trunkedSystems)) data.trunkedSystems = [];
      data.agencies.forEach((a: any) => { if (!Array.isArray(a.frequencies)) a.frequencies = []; });
      data.trunkedSystems.forEach((s: any) => {
        if (!Array.isArray(s.talkgroups)) s.talkgroups = [];
        if (!Array.isArray(s.frequencies)) s.frequencies = [];
      });
    }

    const groundingChunks = usedTools ? (response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []) : [];

    return res.status(200).json({ data, groundingChunks, rawText: text });

  } catch (error: any) {
    console.error("API Error:", error);
    const errString = JSON.stringify(error);
    if (errString.includes("API_KEY_INVALID") || error.message?.includes("API_KEY_INVALID")) {
      return res.status(500).json({ error: "System Communication Error. Please contact administrator." });
    }
    return res.status(500).json({ error: "Unable to retrieve frequency data at this time." });
  }
}
