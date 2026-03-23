export interface ResolvedLocation {
    type: 'zip' | 'county' | 'city';
    standardizedName: string; // e.g. "Washington County, UT"
    isZip: boolean;
    primaryZip: string | null;  // The user's input ZIP, or a "central" ZIP if text search
    countyId?: string;          // Optional RR County ID if known
    zips: string[];             // ALL ZIP codes in this county (for bulk caching)
}

export const resolveLocationDetails = async (query: string): Promise<ResolvedLocation> => {
    const trimmedQuery = query.trim();

    // 1. Fast Path: If it looks like a valid 5-digit ZIP, return immediately.
    // This saves an AI call for the most common case.
    const zipMatch = trimmedQuery.match(/^(\d{5})$/);
    if (zipMatch) {
        return {
            type: 'zip',
            standardizedName: `ZIP ${zipMatch[1]}`, // We'll let the main search refine this name
            isZip: true,
            primaryZip: zipMatch[1],
            zips: [zipMatch[1]] // We don't know the others yet, so just cache this one
        };
    }

    // Text resolution intentionally stays local-only so the browser never needs an AI key.
    return {
        type: /county/i.test(trimmedQuery) ? 'county' : 'city',
        standardizedName: trimmedQuery,
        isZip: false,
        primaryZip: null,
        zips: []
    };
};
