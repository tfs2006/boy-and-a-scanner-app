import { GoogleGenAI } from "@google/genai";

const MODEL_NAME = "gemini-2.0-flash";

export interface ResolvedLocation {
    type: 'zip' | 'county' | 'city';
    standardizedName: string; // e.g. "Washington County, UT"
    isZip: boolean;
    primaryZip: string | null;  // The user's input ZIP, or a "central" ZIP if text search
    countyId?: string;          // Optional RR County ID if known
    zips: string[];             // ALL ZIP codes in this county (for bulk caching)
}

export const resolveLocationDetails = async (query: string): Promise<ResolvedLocation> => {
    // 1. Fast Path: If it looks like a valid 5-digit ZIP, return immediately.
    // This saves an AI call for the most common case.
    const zipMatch = query.match(/^(\d{5})$/);
    if (zipMatch) {
        return {
            type: 'zip',
            standardizedName: `ZIP ${zipMatch[1]}`, // We'll let the main search refine this name
            isZip: true,
            primaryZip: zipMatch[1],
            zips: [zipMatch[1]] // We don't know the others yet, so just cache this one
        };
    }

    // 2. AI Resolution for Text (e.g., "St George", "Washington County UT")
    // We need to know: "What County is this?" and "What are ALL ZIPs in that County?"
    try {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("Missing API Key for Location Service");

        const ai = new GoogleGenAI({ apiKey });

        // We use a very strict JSON prompt
        const prompt = `
      Task: Identify the US County and State for the location "${query}".
      Output: JSON only.
      
      Requirements:
      1. Identify the 'County, State' for "${query}".
      2. List ALL 5-digit ZIP codes physically located in that County.
      3. Pick one "central" or "populous" ZIP code as the 'primaryZip' (proxy).
      
      Format:
      \`\`\`json
      {
        "standardizedName": "Washington County, UT",
        "primaryZip": "84770",
        "zips": ["84770", "84771", "84790", "84780"]
      }
      \`\`\`
    `;

        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        const text = response?.text || "{}";
        const data = JSON.parse(text);

        if (!data.standardizedName || !Array.isArray(data.zips)) {
            throw new Error("Invalid AI Location Resolution");
        }

        return {
            type: 'county',
            standardizedName: data.standardizedName,
            isZip: false,
            primaryZip: data.primaryZip || data.zips[0],
            zips: data.zips
        };

    } catch (err: any) {
        console.warn("Location Resolution Failed:", err);
        // Fallback: Treat as a dumb string, return as is.
        return {
            type: 'city',
            standardizedName: query,
            isZip: false,
            primaryZip: null,
            zips: []
        };
    }
};
