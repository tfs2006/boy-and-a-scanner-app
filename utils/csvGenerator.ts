
import { ScanResult, TripResult } from '../types';

/**
 * Standard CSV Headers compatible with generic import tools
 */
const CSV_HEADERS = [
  'Location',
  'Category_Type',
  'System_Agency',
  'Department_Group',
  'Frequency_TGID',
  'Tone_NAC_CC',
  'Mode',
  'Alpha_Tag',
  'Description'
];

/**
 * Helper to escape characters for CSV format
 */
const escapeCsv = (str: string | undefined): string => {
  if (!str) return '';
  const safeStr = String(str).replace(/"/g, '""'); // Double up quotes
  if (safeStr.includes(',') || safeStr.includes('"') || safeStr.includes('\n')) {
    return `"${safeStr}"`;
  }
  return safeStr;
};

/**
 * Flattens a single ScanResult into CSV rows
 */
const processScanResult = (data: ScanResult): string[][] => {
  const rows: string[][] = [];
  const location = data.locationName;

  // 1. Process Conventional Agencies
  data.agencies.forEach(agency => {
    agency.frequencies.forEach(freq => {
      rows.push([
        location,
        'Conventional',
        agency.category, // System_Agency column context
        agency.name,     // Department_Group column context
        freq.freq,
        freq.tone || freq.nac || freq.colorCode || '',
        freq.mode,
        freq.alphaTag || '',
        freq.description
      ]);
    });
  });

  // 2. Process Trunked Systems
  data.trunkedSystems.forEach(sys => {
    // Add Control Channels as rows (marked as Site Freqs)
    if (sys.frequencies) {
        sys.frequencies.forEach(f => {
            rows.push([
                location,
                'Trunked Site',
                sys.name,
                sys.location, // Site Name
                f.freq,
                '',
                sys.type, // Mode context
                f.use || 'Control',
                `Site Frequency (${f.use || 'Control'})`
            ]);
        });
    }

    // Add Talkgroups
    sys.talkgroups.forEach(tg => {
      rows.push([
        location,
        'Trunked Talkgroup',
        sys.name,
        tg.tag || 'Talkgroup', // Department context
        tg.dec,
        tg.colorCode || '',
        tg.mode,
        tg.alphaTag,
        tg.description
      ]);
    });
  });

  return rows;
};

/**
 * Trigger browser download
 */
const downloadCsv = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

/**
 * Main Export Function
 */
export const generateCSV = (data: ScanResult | TripResult) => {
  let allRows: string[][] = [];
  let filename = 'scanner_data.csv';

  // Determine if it's a Trip or Single Result based on property existence
  if ('startLocation' in data) {
    // It's a TripResult
    const trip = data as TripResult;
    filename = `Trip_${trip.startLocation}_to_${trip.endLocation}.csv`.replace(/\s+/g, '_');
    
    trip.locations.forEach(loc => {
      const locRows = processScanResult(loc.data);
      allRows = [...allRows, ...locRows];
    });

  } else {
    // It's a single ScanResult
    const scan = data as ScanResult;
    filename = `Scan_${scan.locationName}.csv`.replace(/\s+/g, '_');
    allRows = processScanResult(scan);
  }

  // Combine Headers and Rows
  const csvContent = [
    CSV_HEADERS.join(','),
    ...allRows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');

  downloadCsv(csvContent, filename);
};
