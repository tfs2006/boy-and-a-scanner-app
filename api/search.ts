import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureAppAiConfig, generateAppAiContent } from './appAiProvider';

const MODEL_TIMEOUT_MS = 40_000;
const DEBUG_LOGS = process.env.NODE_ENV !== 'production';

function debugLog(...args: unknown[]) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
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
    const { location, serviceTypes, locationContext } = req.body;

    if (!location || !serviceTypes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Sanitize input
    const safeLocation = String(location).replace(/[^a-zA-Z0-9\s,.-]/g, "").trim().slice(0, 100);
    const safeServices = Array.isArray(serviceTypes) ? serviceTypes.slice(0, 20) : ['Police', 'Fire', 'EMS'];
    const safeContext = locationContext && typeof locationContext === 'object'
      ? {
          query: String(locationContext.query || '').replace(/[^a-zA-Z0-9\s,.-]/g, '').trim().slice(0, 100),
          standardizedName: String(locationContext.standardizedName || '').replace(/[^a-zA-Z0-9\s,.-]/g, '').trim().slice(0, 100),
          canonicalName: String(locationContext.canonicalName || '').replace(/[^a-zA-Z0-9\s,.-]/g, '').trim().slice(0, 100),
          city: String(locationContext.city || '').replace(/[^a-zA-Z0-9\s.-]/g, '').trim().slice(0, 80),
          county: String(locationContext.county || '').replace(/[^a-zA-Z0-9\s.-]/g, '').trim().slice(0, 80),
          stateCode: String(locationContext.stateCode || '').replace(/[^A-Za-z]/g, '').trim().slice(0, 2).toUpperCase(),
          primaryZip: String(locationContext.primaryZip || '').replace(/\D/g, '').trim().slice(0, 5),
        }
      : null;

    const contextLines = [
      safeContext?.query ? `- User query: ${safeContext.query}` : '',
      safeContext?.standardizedName ? `- Resolved place: ${safeContext.standardizedName}` : '',
      safeContext?.canonicalName ? `- Canonical coverage area: ${safeContext.canonicalName}` : '',
      safeContext?.city && safeContext?.stateCode ? `- City: ${safeContext.city}, ${safeContext.stateCode}` : '',
      safeContext?.county && safeContext?.stateCode ? `- County: ${safeContext.county} County, ${safeContext.stateCode}` : '',
      safeContext?.primaryZip ? `- Primary ZIP: ${safeContext.primaryZip}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `
    You are an intelligent interface for the RadioReference Database.
    Task: Retrieve the official radio frequency data for Location: "${safeLocation}".

    RESOLVED LOCATION CONTEXT:
    ${contextLines || '- No extra resolved context available.'}
    Use the resolved location context above as authoritative. Do not drift to similarly named cities, counties, or states.
    
    CRITICAL: VERIFY THE LOCATION FIRST.
    1. If the input is a ZIP CODE (e.g., "${safeLocation}"), use Google Search to confirm the exact City, County, and STATE.
       - Example: "84770" is Washington, UTAH (UT). Do NOT confuse it with Washington, WI or DC.
       - If the user provides a City/State, ensure it exists.
    2. Once the location is verified, retrieve radio data for that SPECIFIC location.

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
      "coords": { "lat": 0.0, "lng": 0.0 },
      "summary": "Overview...",
      "crossRef": { "verified": true, "confidenceScore": 95, "sourcesChecked": 3, "notes": "Verified location as [City, State] via search." },
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

    const { text, groundingChunks } = await generateAppAiContent({
      prompt,
      timeoutMs: MODEL_TIMEOUT_MS,
      allowSearchTools: true,
    });
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
        try { data = JSON.parse(text.substring(start, end + 1)); } catch (e2) { }
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

    if (!data || (!data.locationName && data.agencies.length === 0 && data.trunkedSystems.length === 0)) {
      console.error('Search API returned unparsable or empty AI payload:', text);
      return res.status(502).json({ error: 'AI returned malformed frequency data.' });
    }

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
