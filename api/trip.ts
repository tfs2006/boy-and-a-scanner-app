import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.0-flash";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not configured in Vercel environment");
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { start, end, serviceTypes } = req.body;

    if (!start || !end) {
      return res.status(400).json({ error: 'Missing start or end location' });
    }

    const safeStart = String(start).replace(/[^a-zA-Z0-9\s,.-]/g, "").trim().slice(0, 100);
    const safeEnd = String(end).replace(/[^a-zA-Z0-9\s,.-]/g, "").trim().slice(0, 100);
    const safeServices = Array.isArray(serviceTypes) ? serviceTypes.slice(0, 20) : ['Police', 'Fire', 'EMS'];

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
    I am planning a road trip from ${safeStart} to ${safeEnd}.
    
    Task:
    1. Identify the driving route and select 3-5 major distinct jurisdictions (Counties/Cities) along the path.
    2. For EACH jurisdiction, retrieve detailed radio frequency data for: ${safeServices.join(', ')}.
    
    CRITICAL DATA REQUIREMENTS:
    - You MUST provide specific frequencies, tones, and talkgroups. Do not just list agency names.
    - If a system is P25/Trunked, you MUST list the "Control Channel" frequencies for the local sites.
    
    OUTPUT FORMAT:
    Return a single JSON object in this exact structure:
    \`\`\`json
    {
      "startLocation": "${safeStart}",
      "endLocation": "${safeEnd}",
      "locations": [
        {
          "locationName": "Name of County/City, State",
          "data": {
             "source": "AI",
             "locationName": "Name of County/City",
             "summary": "Brief overview of radio systems here.",
             "agencies": [
                {
                  "name": "Agency Name (e.g. Sheriff)",
                  "category": "Police",
                  "frequencies": [
                    { "freq": "155.000", "description": "Dispatch", "mode": "FMN", "tag": "Dispatch", "alphaTag": "SHERIFF", "tone": "100.0" }
                  ]
                }
             ],
             "trunkedSystems": [
                {
                  "name": "System Name",
                  "type": "P25 Standard",
                  "location": "Site Name",
                  "frequencies": [ { "freq": "851.000", "use": "Control" } ],
                  "talkgroups": [ { "dec": "101", "mode": "D", "alphaTag": "DISP", "description": "Dispatch", "tag": "Law Dispatch" } ]
                }
             ]
          }
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
      console.warn("Google Search Tool rejected. Retrying trip plan without tools...");
      usedTools = false;
      response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
      });
    }

    const text = response?.text || "{}";
    let trip: any = null;

    try {
      const match = text.match(/```json\n([\s\S]*?)(\n```|$)/);
      if (match && match[1]) {
        trip = JSON.parse(match[1]);
      } else {
        trip = JSON.parse(text);
      }
    } catch (e) {
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        try { trip = JSON.parse(text.substring(startIdx, endIdx + 1)); } catch (e2) {}
      }
    }

    if (trip) {
      if (!Array.isArray(trip.locations)) trip.locations = [];
      trip.locations.forEach((loc: any) => {
        if (!loc.data) {
          loc.data = { source: 'AI', locationName: loc.locationName || 'Unknown', summary: 'Unavailable', agencies: [], trunkedSystems: [] };
        } else {
          loc.data.source = 'AI';
          if (!Array.isArray(loc.data.agencies)) loc.data.agencies = [];
          if (!Array.isArray(loc.data.trunkedSystems)) loc.data.trunkedSystems = [];
          loc.data.agencies.forEach((a: any) => { if (!Array.isArray(a.frequencies)) a.frequencies = []; });
          loc.data.trunkedSystems.forEach((s: any) => {
            if (!Array.isArray(s.talkgroups)) s.talkgroups = [];
            if (!Array.isArray(s.frequencies)) s.frequencies = [];
          });
        }
      });
    }

    const groundingChunks = usedTools ? (response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []) : [];

    return res.status(200).json({ trip, groundingChunks });

  } catch (error: any) {
    console.error("Trip API Error:", error);
    return res.status(500).json({ error: "Unable to plan trip route at this time." });
  }
}
