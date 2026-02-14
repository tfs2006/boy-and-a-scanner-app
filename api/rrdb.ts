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

      // Validation: Verify State ID matches ZIP prefix
      // WI (49) starts with 53, 54. UT (44) starts with 84.
      const isValid = validateZipState(zip, s);
      if (isValid) {
        bestMatch = { ctid: c, stid: s, city };
        break;
      }
    }

    // Fallback if validation fails (just take first valid item)
    if (!bestMatch && zipItems.length > 0) {
      const first = zipItems[0];
      const c = getTextContent(first, 'ctid');
      const s = getTextContent(first, 'stid');
      const city = getTextContent(first, 'city');
      if (c && c !== '0') bestMatch = { ctid: c, stid: s, city };
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
    const countyXml = await soapCall('getCountyInfo', `
      <ctid xsi:type="xsd:int">${ctid}</ctid>
      ${authXml}
    `);

    const countyName = getTextContent(countyXml, 'countyName');
    const locationName = `${countyName || city}, ${getStateName(stid)}`;

    // Parse categories & subcategories to get scids
    const subcatIds = parseSubcategories(countyXml);

    // Parse trunked system list
    const trsListRaw = parseTrsList(countyXml);

    // -------------------------------------------------------
    // Step 3: Get conventional frequencies from subcategories
    // -------------------------------------------------------
    console.log(`[RR API] Step 3: Fetching ${subcatIds.length} subcategory frequency sets`);

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
    }

    // Fetch all frequencies for each subcategory (but limit concurrency)
    const agencies: any[] = [];
    const batchSize = 5;

    for (let i = 0; i < subcatIds.length; i += batchSize) {
      const batch = subcatIds.slice(i, i + batchSize);
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

    // Limit to first 10 trunked systems to avoid timeout
    const trsToFetch = trsListRaw.slice(0, 10);

    for (const trs of trsToFetch) {
      try {
        // Get system details
        const detailXml = await soapCall('getTrsDetails', `
          <sid xsi:type="xsd:int">${trs.sid}</sid>
          ${authXml}
        `);
        const sysName = getTextContent(detailXml, 'sName') || trs.sName;
        const sysType = getTextContent(detailXml, 'sType') || '';

        // Get sites (includes site frequencies / control channels)
        const sitesXml = await soapCall('getTrsSites', `
          <sid xsi:type="xsd:int">${trs.sid}</sid>
          ${authXml}
        `);
        const sites = parseSites(sitesXml, ctid);

        // Get talkgroups (filtered by relevant tags if possible)
        const tgXml = await soapCall('getTrsTalkgroups', `
          <sid xsi:type="xsd:int">${trs.sid}</sid>
          <tgCid xsi:type="xsd:int">0</tgCid>
          <tgTag xsi:type="xsd:int">0</tgTag>
          <tgDec xsi:type="xsd:int">0</tgDec>
          ${authXml}
        `);
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
      summary: `RadioReference verified data for ${locationName}. Found ${agencies.length} conventional agencies and ${trunkedSystems.length} trunked systems from the official database.`,
      crossRef: {
        verified: true,
        confidenceScore: 100,
        sourcesChecked: 1,
        notes: `Data retrieved directly from RadioReference.com database (County ID: ${ctid}). This is verified, authoritative source data.`
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

// Validate if the ZIP code prefix matches the expected RadioReference State ID
function validateZipState(zip: string, stid: string): boolean {
  if (!zip || !stid) return false;
  const prefix = parseInt(zip.substring(0, 2));
  const s = parseInt(stid);

  if (isNaN(prefix) || isNaN(s)) return false;

  // UT (44) starts with 84
  if (s === 44) return prefix >= 84 && prefix <= 84;

  // WI (49) starts with 53, 54
  if (s === 49) return prefix >= 53 && prefix <= 54;

  return true; // Default to true for other states
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
