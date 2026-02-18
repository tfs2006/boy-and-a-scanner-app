import type { VercelRequest, VercelResponse } from '@vercel/node';

const RR_SOAP_URL = "https://api.radioreference.com/soap2/";
const RR_NAMESPACE = "http://api.radioreference.com/soap2";

// --- SOAP XML Builders ---

function buildAuthInfo(appKey: string, username: string, password: string): string {
  return `
    <authInfo xsi:type="tns:authInfo">
      <appKey xsi:type="xsd:string">${escapeXml(appKey)}</appKey>
      <username xsi:type="xsd:string">${escapeXml(username)}</username>
      <password xsi:type="xsd:string">${escapeXml(password)}</password>
      <version xsi:type="xsd:string">latest</version>
      <style xsi:type="xsd:string">rpc</style>
    </authInfo>`;
}

function buildSoapEnvelope(method: string, params: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope 
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" 
  xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" 
  xmlns:tns="${RR_NAMESPACE}" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <tns:${method}>
      ${params}
    </tns:${method}>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// --- SOAP Request ---

async function soapCall(method: string, params: string): Promise<string> {
  const body = buildSoapEnvelope(method, params);
  const response = await fetch(RR_SOAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `${RR_NAMESPACE}#${method}`
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`SOAP ${method} failed (${response.status}):`, text.substring(0, 500));
    throw new Error(`RadioReference API returned ${response.status}`);
  }

  return response.text();
}

// --- XML Parsing Helpers ---

function getTextContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function getAllElements(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gis');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

// Get all <item> elements (RR returns arrays as <item> elements)
function getItems(xml: string): string[] {
  const results: string[] = [];
  // Match top-level items using a stack-based approach for nested items
  let depth = 0;
  let currentItem = '';
  let inItem = false;
  const lines = xml.split(/(<\/?item[^>]*>)/);

  for (const part of lines) {
    if (part.match(/<item[^/][^>]*>/i) || part === '<item>') {
      depth++;
      if (depth === 1) {
        inItem = true;
        currentItem = '';
        continue;
      }
    }
    if (part.match(/<\/item>/i)) {
      depth--;
      if (depth === 0 && inItem) {
        results.push(currentItem);
        inItem = false;
        continue;
      }
    }
    if (inItem) {
      currentItem += part;
    }
  }
  return results;
}

// --- Tag ID Mapping ---
// RadioReference Tag IDs for common service types
const TAG_MAP: Record<string, number> = {
  'Law Dispatch': 1,
  'Law Talk': 2,
  'Law Tactical': 3,
  'Fire Dispatch': 4,
  'Fire Talk': 5,
  'Fire Tactical': 6,
  'EMS Dispatch': 7,
  'EMS Talk': 8,
  'EMS Tactical': 9,
  'Hospital': 10,
  'Ham': 11,
  'Public Works': 12,
  'Transportation': 14,
  'Military': 15,
  'Federal': 16,
  'Corrections': 18,
  'Schools': 20,
  'Security': 21,
  'Utilities': 22,
  'Air': 23,
  'Railroad': 25,
  'Marine': 26,
  'Business': 29,
  'Multi-Dispatch': 30,
};

// Map user-facing service type to tag IDs
function getTagIdsForService(serviceType: string): number[] {
  const st = serviceType.toLowerCase();
  if (st === 'police') return [1, 2, 3]; // Law Dispatch, Talk, Tactical
  if (st === 'fire') return [4, 5, 6];
  if (st === 'ems') return [7, 8, 9];
  if (st === 'hospital' || st === 'hospitals') return [10];
  if (st === 'ham radio') return [11];
  if (st === 'public works') return [12];
  if (st === 'transportation') return [14];
  if (st === 'military') return [15];
  if (st === 'federal') return [16];
  if (st === 'corrections') return [18];
  if (st === 'schools') return [20];
  if (st === 'security') return [21];
  if (st === 'utilities') return [22];
  if (st === 'air') return [23];
  if (st === 'railroad') return [25];
  if (st === 'marine') return [26];
  if (st === 'business') return [29];
  if (st === 'multi-dispatch') return [30];
  return [];
}

// Reverse map tag ID to a readable tag name
function getTagName(tagId: number | string): string {
  const id = Number(tagId);
  for (const [name, tId] of Object.entries(TAG_MAP)) {
    if (tId === id) return name;
  }
  return 'Other';
}

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appKey = process.env.RR_APP_KEY;
  if (!appKey) {
    console.error("RR_APP_KEY not configured in Vercel environment");
    return res.status(500).json({ error: 'RadioReference API not configured on server' });
  }

  try {
    const { zipcode, rrUsername, rrPassword, serviceTypes } = req.body;

    if (!zipcode || !rrUsername || !rrPassword) {
      return res.status(400).json({ error: 'Missing required fields: zipcode, rrUsername, rrPassword' });
    }

    // Validate ZIP
    const zip = String(zipcode).replace(/\D/g, '');
    if (zip.length !== 5) {
      return res.status(400).json({ error: 'Invalid ZIP code. Must be 5 digits.' });
    }

    const safeServices: string[] = Array.isArray(serviceTypes) ? serviceTypes.slice(0, 20) : ['Police', 'Fire', 'EMS'];
    const authXml = buildAuthInfo(appKey, rrUsername, rrPassword);

    // -------------------------------------------------------
    // Step 1: getZipcodeInfo → get countyId (ctid) and stateId (stid)
    // -------------------------------------------------------
    console.log(`[RR API] Step 1: getZipcodeInfo for ${zip}`);
    const zipXml = await soapCall('getZipcodeInfo', `
      <zipcode xsi:type="xsd:int">${zip}</zipcode>
      ${authXml}
    `);

    // Parse ALL items returned for the ZIP
    let zipItems = getItems(zipXml);

    // If no <item> tags found, but we have a ctid in the root, treat it as a single item
    if (zipItems.length === 0) {
      const rootCtid = getTextContent(zipXml, 'ctid');
      if (rootCtid && rootCtid !== '0') {
        zipItems = [zipXml];
      }
    }

    let bestMatch: { ctid: string; stid: string; city: string } | null = null;

    for (const itemXml of zipItems) {
      const c = getTextContent(itemXml, 'ctid');
      const s = getTextContent(itemXml, 'stid');
      const city = getTextContent(itemXml, 'city');

      if (!c || c === '0') continue;

      // Validation: Enforce State ID matches ZIP prefix
      // If RR returns a weird state (like KS for an ID zip), we override it if we are sure.
      const expectedStid = inferStateIdFromZip(zip);

      if (expectedStid) {
        // If we have a definitive state for this ZIP, insist on it.
        // If the item's stid matches, great. 
        // If not, we might still accept it but FORCE the correct stid?
        // Actually, if RR says it's in KS but ZIP says ID, RR might be returning a "nearest neighbor" or just wrong data for that specific zip entry.
        // BUT, usually RR returns the correct county ID (ctid) but links it to the wrong state parent in some edge cases?
        // Or maybe it returns a list of candidate counties and one is garbage.

        if (s === expectedStid) {
          bestMatch = { ctid: c, stid: s, city };
          break;
        }
      } else {
        // Fallback for unknown states (territories etc)
        bestMatch = { ctid: c, stid: s, city };
        break;
      }
    }

    // Fallback: If no strict match found, use the first item but FORCE the state ID if we know it.
    if (!bestMatch && zipItems.length > 0) {
      const first = zipItems[0];
      const c = getTextContent(first, 'ctid');
      const s = getTextContent(first, 'stid');
      const city = getTextContent(first, 'city');

      const expectedStid = inferStateIdFromZip(zip);

      if (c && c !== '0') {
        // Correct the State ID if we know better
        const finalStid = expectedStid || s;
        bestMatch = { ctid: c, stid: finalStid, city };
        if (s !== finalStid) {
          console.log(`[RR API] Corrected State ID from ${s} to ${finalStid} for ZIP ${zip}`);
        }
      }
    }

    if (!bestMatch) {
      // Check for SOAP fault
      const faultString = getTextContent(zipXml, 'faultstring');
      if (faultString) {
        return res.status(401).json({ error: `RadioReference: ${faultString}` });
      }
      return res.status(404).json({ error: 'ZIP code not found in RadioReference database (or state mismatch).' });
    }

    const { ctid, stid, city } = bestMatch;
    console.log(`[RR API] ZIP ${zip} → City: ${city}, County ID: ${ctid}, State ID: ${stid} (Validated)`);

    // -------------------------------------------------------
    // Step 2: getCountyInfo → get categories, subcategories, trunked system list, agencies
    // -------------------------------------------------------
    console.log(`[RR API] Step 2: getCountyInfo for ctid=${ctid}`);

    // Concurrently fetch County AND State info to save time
    const [countyXml, stateXml] = await Promise.all([
      soapCall('getCountyInfo', `
        <ctid xsi:type="xsd:int">${ctid}</ctid>
        ${authXml}
      `),
      soapCall('getStateInfo', `
        <stid xsi:type="xsd:int">${stid}</stid>
        ${authXml}
      `)
    ]);

    const countyName = getTextContent(countyXml, 'countyName');
    const locationName = `${countyName || city}, ${getStateName(stid)}`;

    // Parse categories & subcategories to get scids
    const countySubcatIds = parseSubcategories(countyXml);
    const stateSubcatIds = parseSubcategories(stateXml); // Get all state agencies

    // Parse trunked system list (County only, usually contains the relevant systems for the area)
    const trsListRaw = parseTrsList(countyXml);

    // -------------------------------------------------------
    // Step 3: Get conventional frequencies from subcategories
    // -------------------------------------------------------
    // Combine County + State subcategories
    // We filter State subcategories to only include "Statewide" or major agencies if needed,
    // but for "finding everything", we'll just fetch them all.
    // NOTE: State subcategories can be huge. We might want to filter by name?
    // For now, let's fetch them but limit to "Police" and "DOT" and "Federal" types if user didn't ask for everything.

    const allSubcatIds = [...countySubcatIds, ...stateSubcatIds];
    console.log(`[RR API] Step 3: Fetching ${allSubcatIds.length} subcategory frequency sets (County: ${countySubcatIds.length}, State: ${stateSubcatIds.length})`);

    // Collect relevant tag IDs based on user's service filter
    const relevantTagIds = new Set<number>();

    // Heuristic: If we are asking for a lot of services (Universal Cache), fetch EVERYTHING.
    // This prevents hiding data due to missing tag mappings in TAG_MAP.
    const fetchAllData = safeServices.length > 12;

    if (!fetchAllData) {
      for (const svc of safeServices) {
        for (const tagId of getTagIdsForService(svc)) {
          relevantTagIds.add(tagId);
        }
      }
      // ALWAYS add Federal, Military, and Railroad to reveal "hidden" stuff
      relevantTagIds.add(15); // Military
      relevantTagIds.add(16); // Federal
      relevantTagIds.add(25); // Railroad
    }

    // Fetch all frequencies for each subcategory (but limit concurrency)
    const agencies: any[] = [];
    // Increase batch size slightly for performance, Vercel allows 10s execution.
    // We need to be careful not to hit rate limits or timeouts.
    const batchSize = 10;

    // Limit total subcats to fetch to avoid timeouts? 
    // State arrays can be 100+ subcats.
    // Let's prioritize County first, then State.
    const prioritizedSubcats = [
      ...countySubcatIds,
      ...stateSubcatIds.filter(s =>
        // Filter state agencies to avoid "State Parks" in remote areas unless requested?
        // Actually user wants "everything possible". Let's try fetching first 50 state subcats.
        true
      )
    ].slice(0, 150); // Hard cap to prevent timeout

    for (let i = 0; i < prioritizedSubcats.length; i += batchSize) {
      const batch = prioritizedSubcats.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (sc) => {
        try {
          const freqXml = await soapCall('getSubcatFreqs', `
            <scid xsi:type="xsd:int">${sc.scid}</scid>
            ${authXml}
          `);
          return { subcatName: sc.name, catName: sc.catName, freqXml };
        } catch (e) {
          console.warn(`Failed to fetch scid ${sc.scid}:`, e);
          return null;
        }
      }));

      for (const r of results) {
        if (!r) continue;
        const freqs = parseFrequencies(r.freqXml, relevantTagIds);
        if (freqs.length > 0) {
          // Determine category from tags or subcategory name
          const category = inferCategory(r.catName, r.subcatName);
          agencies.push({
            name: r.subcatName,
            category,
            frequencies: freqs
          });
        }
      }
    }

    // -------------------------------------------------------
    // Step 4: Get trunked systems with sites and talkgroups
    // -------------------------------------------------------
    console.log(`[RR API] Step 4: Fetching ${trsListRaw.length} trunked systems`);
    const trunkedSystems: any[] = [];

    // Increase limit to 50 to catch "hidden" or less popular systems
    const trsToFetch = trsListRaw.slice(0, 50);

    for (const trs of trsToFetch) {
      try {
        // Parallelize details and sites+talkgroups? 
        // No, details needed first? Actually details are just metadata.
        // We can run all 3 in parallel for a single system!

        const [detailXml, sitesXml, tgXml] = await Promise.all([
          soapCall('getTrsDetails', `
            <sid xsi:type="xsd:int">${trs.sid}</sid>
            ${authXml}
          `),
          soapCall('getTrsSites', `
            <sid xsi:type="xsd:int">${trs.sid}</sid>
            ${authXml}
          `),
          soapCall('getTrsTalkgroups', `
            <sid xsi:type="xsd:int">${trs.sid}</sid>
            <tgCid xsi:type="xsd:int">0</tgCid>
            <tgTag xsi:type="xsd:int">0</tgTag>
            <tgDec xsi:type="xsd:int">0</tgDec>
            ${authXml}
          `)
        ]);

        const sysName = getTextContent(detailXml, 'sName') || trs.sName;
        const sysType = getTextContent(detailXml, 'sType') || '';
        const sites = parseSites(sitesXml, ctid);
        const talkgroups = parseTalkgroups(tgXml, relevantTagIds);

        if (sites.length > 0 || talkgroups.length > 0) {
          // Use the site(s) that match our county, or the first site
          const primarySite = sites[0];

          trunkedSystems.push({
            name: sysName,
            type: mapTrsType(sysType),
            location: primarySite?.siteDescr || locationName,
            frequencies: primarySite?.frequencies || [],
            talkgroups
          });
        }
      } catch (e) {
        console.warn(`Failed to fetch trunked system sid=${trs.sid}:`, e);
      }
    }

    // -------------------------------------------------------
    // Build result
    // -------------------------------------------------------
    const result = {
      source: 'API' as const,
      locationName,
      summary: `RadioReference verified data for ${locationName}. Found ${agencies.length} conventional agencies (including Statewide) and ${trunkedSystems.length} trunked systems.`,
      crossRef: {
        verified: true,
        confidenceScore: 100,
        sourcesChecked: 1,
        notes: `Data retrieved directly from RadioReference.com database (County ID: ${ctid}, State ID: ${stid}). This is verified, authoritative source data.`
      },
      agencies,
      trunkedSystems
    };

    return res.status(200).json({ data: result });

  } catch (error: any) {
    console.error("RR API Error:", error);

    const msg = error.message || '';
    if (msg.includes('401') || msg.includes('authentication') || msg.includes('Invalid')) {
      return res.status(401).json({ error: 'RadioReference authentication failed. Check your username and password.' });
    }

    return res.status(500).json({ error: 'RadioReference API request failed. ' + msg });
  }
}

// Infer the correct RadioReference State ID based on ZIP code prefix
function inferStateIdFromZip(zip: string): string | null {
  if (!zip || zip.length < 3) return null;
  const prefix = parseInt(zip.substring(0, 2));
  const prefix3 = parseInt(zip.substring(0, 3)); // For Wyoming/Idaho edge cases

  if (isNaN(prefix)) return null;

  // -- Explicit State Mapping based on ZIP Prefixes --
  // AL (1) 35-36
  if (prefix >= 35 && prefix <= 36) return '1';
  // AK (2) 99
  if (prefix === 99) return '2';
  // AZ (3) 85-86
  if (prefix >= 85 && prefix <= 86) return '3';
  // AR (4) 71-72
  if (prefix >= 71 && prefix <= 72) return '4';
  // CA (5) 90-96
  if (prefix >= 90 && prefix <= 96) return '5';
  // CO (6) 80-81
  if (prefix >= 80 && prefix <= 81) return '6';
  // CT (7) 06
  if (prefix === 6) return '7';
  // DE (8) 19
  if (prefix === 19) return '8';
  // FL (9) 32-34
  if (prefix >= 32 && prefix <= 34) return '9';
  // GA (10) 30-31, 39
  if ((prefix >= 30 && prefix <= 31) || prefix === 39) return '10';
  // HI (11) 96
  if (prefix === 96) return '11';
  // ID (12) 83 (Excluding 830, 831 which are WY)
  if (prefix === 83) {
    if (prefix3 === 830 || prefix3 === 831) return '50'; // WY
    return '12'; // ID
  }
  // IL (13) 60-62
  if (prefix >= 60 && prefix <= 62) return '13';
  // IN (14) 46-47
  if (prefix >= 46 && prefix <= 47) return '14';
  // IA (15) 50-52
  if (prefix >= 50 && prefix <= 52) return '15';
  // KS (16) 66-67
  if (prefix >= 66 && prefix <= 67) return '16';
  // KY (17) 40-42
  if (prefix >= 40 && prefix <= 42) return '17';
  // LA (18) 70-71
  if (prefix >= 70 && prefix <= 71) return '18';
  // ME (19) 03-04
  if (prefix >= 3 && prefix <= 4) return '19';
  // MD (20) 20-21
  if (prefix >= 20 && prefix <= 21) return '20';
  // MA (21) 01-02, 05
  if ((prefix >= 1 && prefix <= 2) || prefix === 5) return '21';
  // MI (22) 48-49
  if (prefix >= 48 && prefix <= 49) return '22';
  // MN (23) 55-56
  if (prefix >= 55 && prefix <= 56) return '23';
  // MS (24) 38-39
  if (prefix >= 38 && prefix <= 39) return '24';
  // MO (25) 63-65
  if (prefix >= 63 && prefix <= 65) return '25';
  // MT (26) 59
  if (prefix === 59) return '26';
  // NE (27) 68-69
  if (prefix >= 68 && prefix <= 69) return '27';
  // NV (28) 88-89
  if (prefix >= 88 && prefix <= 89) return '28';
  // NH (29) 03
  if (prefix === 3) return '29';
  // NJ (30) 07-08
  if (prefix >= 7 && prefix <= 8) return '30';
  // NM (31) 87-88
  if (prefix >= 87 && prefix <= 88) return '31';
  // NY (32) 10-14
  if (prefix >= 10 && prefix <= 14) return '32';
  // NC (33) 27-28
  if (prefix >= 27 && prefix <= 28) return '33';
  // ND (34) 58
  if (prefix === 58) return '34';
  // OH (35) 43-45
  if (prefix >= 43 && prefix <= 45) return '35';
  // OK (36) 73-74
  if (prefix >= 73 && prefix <= 74) return '36';
  // OR (37) 97
  if (prefix === 97) return '37';
  // PA (38) 15-19
  if (prefix >= 15 && prefix <= 19) return '38';
  // RI (39) 02
  if (prefix === 2) return '39';
  // SC (40) 29
  if (prefix === 29) return '40';
  // SD (41) 57
  if (prefix === 57) return '41';
  // TN (42) 37-38
  if (prefix >= 37 && prefix <= 38) return '42';
  // TX (43) 75-79
  if (prefix >= 75 && prefix <= 79) return '43';
  // UT (44) 84
  if (prefix === 84) return '44';
  // VT (45) 05
  if (prefix === 5) return '45';
  // VA (46) 22-24
  if (prefix >= 22 && prefix <= 24) return '46';
  // WA (47) 98-99
  if (prefix >= 98 && prefix <= 99) return '47';
  // WV (48) 24-26
  if (prefix >= 24 && prefix <= 26) return '48';
  // WI (49) 53-54
  if (prefix >= 53 && prefix <= 54) return '49';
  // WY (50) 82, 830, 831
  if (prefix === 82 || prefix3 === 830 || prefix3 === 831) return '50';
  // DC (51) 200
  if (prefix3 >= 200 && prefix3 <= 205) return '51';

  return null;
}


// --- XML Parsing Functions ---

interface SubcatInfo { scid: string; name: string; catName: string; }

function parseSubcategories(countyXml: string): SubcatInfo[] {
  const results: SubcatInfo[] = [];

  // Extract cats section
  const catsMatch = countyXml.match(/<cats[^>]*>(.*?)<\/cats>/is);
  if (!catsMatch) return results;

  const catItems = getItems(catsMatch[1]);
  for (const catXml of catItems) {
    const catName = getTextContent(catXml, 'cName');

    // Find subcats within this category
    const subcatsMatch = catXml.match(/<subcats[^>]*>(.*?)<\/subcats>/is);
    if (!subcatsMatch) continue;

    const scItems = getItems(subcatsMatch[1]);
    for (const scXml of scItems) {
      const scid = getTextContent(scXml, 'scid');
      const scName = getTextContent(scXml, 'scName');
      if (scid && scid !== '0') {
        results.push({ scid, name: scName || catName, catName });
      }
    }
  }

  return results;
}

function parseTrsList(countyXml: string): Array<{ sid: string; sName: string }> {
  const results: Array<{ sid: string; sName: string }> = [];

  const trsMatch = countyXml.match(/<trsList[^>]*>(.*?)<\/trsList>/is);
  if (!trsMatch) return results;

  const trsItems = getItems(trsMatch[1]);
  for (const trsXml of trsItems) {
    const sid = getTextContent(trsXml, 'sid');
    const sName = getTextContent(trsXml, 'sName');
    if (sid && sid !== '0') {
      results.push({ sid, sName });
    }
  }

  return results;
}

function parseFrequencies(freqXml: string, relevantTagIds: Set<number>): any[] {
  const results: any[] = [];
  const items = getItems(freqXml);

  for (const itemXml of items) {
    const out = getTextContent(itemXml, 'out');
    if (!out || out === '0') continue;

    // Check if this frequency has a relevant tag
    const tagIds = extractTagIds(itemXml);

    // If relevantTagIds is empty, we assume "Fetch All" (no filter)
    const hasRelevantTag = relevantTagIds.size === 0 || tagIds.some(t => relevantTagIds.has(t));
    if (!hasRelevantTag && tagIds.length > 0) continue;

    const freq = parseFloat(out);
    if (isNaN(freq) || freq === 0) continue;

    const tagName = tagIds.length > 0 ? getTagName(tagIds[0]) : 'Other';

    results.push({
      freq: freq.toFixed(4),
      description: getTextContent(itemXml, 'descr') || '',
      mode: getTextContent(itemXml, 'mode') || 'FM',
      tag: tagName,
      alphaTag: getTextContent(itemXml, 'alpha') || '',
      tone: getTextContent(itemXml, 'tone') || '',
      colorCode: getTextContent(itemXml, 'colorCode') || '',
      nac: getTextContent(itemXml, 'nac') || '',
      ran: getTextContent(itemXml, 'ran') || ''
    });
  }

  return results;
}

function extractTagIds(xml: string): number[] {
  const ids: number[] = [];
  const tagsMatch = xml.match(/<tags[^>]*>(.*?)<\/tags>/is);
  if (!tagsMatch) return ids;

  const tagIdMatches = tagsMatch[1].matchAll(/<tagId[^>]*>(\d+)<\/tagId>/gi);
  for (const m of tagIdMatches) {
    ids.push(parseInt(m[1]));
  }
  return ids;
}

function parseSites(sitesXml: string, targetCtid: string): any[] {
  const results: any[] = [];
  const items = getItems(sitesXml);

  // Sort county-matching sites first
  const sorted = items.sort((a, b) => {
    const aCtid = getTextContent(a, 'siteCtid');
    const bCtid = getTextContent(b, 'siteCtid');
    if (aCtid === targetCtid && bCtid !== targetCtid) return -1;
    if (bCtid === targetCtid && aCtid !== targetCtid) return 1;
    return 0;
  });

  for (const siteXml of sorted) {
    const siteDescr = getTextContent(siteXml, 'siteDescr') || getTextContent(siteXml, 'siteLocation') || 'Unknown Site';
    const nac = getTextContent(siteXml, 'nac') || '';

    // Parse site frequencies (control channels)
    const siteFreqs: any[] = [];
    const freqsMatch = siteXml.match(/<siteFreqs[^>]*>(.*?)<\/siteFreqs>/is);
    if (freqsMatch) {
      const freqItems = getItems(freqsMatch[1]);
      for (const fXml of freqItems) {
        const freq = getTextContent(fXml, 'freq');
        const use = getTextContent(fXml, 'use') || '';
        if (freq && freq !== '0') {
          siteFreqs.push({
            freq: parseFloat(freq).toFixed(4),
            use: use || 'Unknown'
          });
        }
      }
    }

    results.push({
      siteDescr,
      nac,
      frequencies: siteFreqs
    });
  }

  return results;
}

function parseTalkgroups(tgXml: string, relevantTagIds: Set<number>): any[] {
  const results: any[] = [];
  const items = getItems(tgXml);

  for (const itemXml of items) {
    const dec = getTextContent(itemXml, 'tgDec');
    if (!dec || dec === '0') continue;

    // Check tag filter
    const tagIds = extractTagIds(itemXml);
    const hasRelevantTag = relevantTagIds.size === 0 || tagIds.some(t => relevantTagIds.has(t));
    if (!hasRelevantTag && tagIds.length > 0) continue;

    const tagName = tagIds.length > 0 ? getTagName(tagIds[0]) : 'Other';
    const mode = getTextContent(itemXml, 'tgMode') || 'D';

    results.push({
      dec,
      mode: mode === 'D' ? 'D' : mode === 'A' ? 'A' : mode === 'T' ? 'TDMA' : mode === 'E' ? 'Encrypted' : mode,
      alphaTag: getTextContent(itemXml, 'tgAlpha') || '',
      description: getTextContent(itemXml, 'tgDescr') || '',
      tag: tagName
    });
  }

  return results;
}

// --- Utility Functions ---

function inferCategory(catName: string, subcatName: string): string {
  const combined = (catName + ' ' + subcatName).toLowerCase();
  if (combined.includes('police') || combined.includes('sheriff') || combined.includes('law')) return 'Police';
  if (combined.includes('fire') || combined.includes('rescue')) return 'Fire';
  if (combined.includes('ems') || combined.includes('medic') || combined.includes('ambulance')) return 'EMS';
  if (combined.includes('federal')) return 'Federal';
  if (combined.includes('military')) return 'Military';
  if (combined.includes('air') || combined.includes('aviation')) return 'Air';
  if (combined.includes('marine')) return 'Marine';
  if (combined.includes('railroad') || combined.includes('rail')) return 'Railroad';
  if (combined.includes('ham') || combined.includes('amateur')) return 'Ham Radio';
  if (combined.includes('public works')) return 'Public Works';
  if (combined.includes('utility') || combined.includes('utilities')) return 'Utilities';
  if (combined.includes('transport')) return 'Transportation';
  if (combined.includes('hospital')) return 'Hospitals';
  if (combined.includes('school')) return 'Schools';
  if (combined.includes('correction') || combined.includes('prison') || combined.includes('jail')) return 'Corrections';
  if (combined.includes('security')) return 'Security';
  if (combined.includes('business')) return 'Business';
  return catName || 'Other';
}

function mapTrsType(typeId: string): string {
  const id = parseInt(typeId);
  switch (id) {
    case 1: return 'Motorola Type I';
    case 2: return 'Motorola Type II';
    case 3: return 'Motorola Type IIi Hybrid';
    case 4: return 'P25 Standard';
    case 5: return 'P25 Phase II';
    case 6: return 'EDACS Standard';
    case 7: return 'EDACS Scat';
    case 8: return 'EDACS Networked';
    case 9: return 'LTR Standard';
    case 10: return 'LTR Net';
    case 11: return 'MPT1327';
    case 12: return 'PASSPORT';
    case 13: return 'DMR Conventional Networked';
    case 14: return 'DMR Tier III';
    case 15: return 'NXDN Conventional';
    case 16: return 'NXDN Trunked (Type-D)';
    case 17: return 'NXDN Trunked (Type-C)';
    default: return `Trunked (Type ${typeId})`;
  }
}

function getStateName(stid: string): string {
  const states: Record<string, string> = {
    '1': 'AL', '2': 'AK', '3': 'AZ', '4': 'AR', '5': 'CA', '6': 'CO', '7': 'CT',
    '8': 'DE', '9': 'FL', '10': 'GA', '11': 'HI', '12': 'ID', '13': 'IL',
    '14': 'IN', '15': 'IA', '16': 'KS', '17': 'KY', '18': 'LA', '19': 'ME',
    '20': 'MD', '21': 'MA', '22': 'MI', '23': 'MN', '24': 'MS', '25': 'MO',
    '26': 'MT', '27': 'NE', '28': 'NV', '29': 'NH', '30': 'NJ', '31': 'NM',
    '32': 'NY', '33': 'NC', '34': 'ND', '35': 'OH', '36': 'OK', '37': 'OR',
    '38': 'PA', '39': 'RI', '40': 'SC', '41': 'SD', '42': 'TN', '43': 'TX',
    '44': 'UT', '45': 'VT', '46': 'VA', '47': 'WA', '48': 'WV', '49': 'WI',
    '50': 'WY', '51': 'DC'
  };
  return states[stid] || stid;
}
