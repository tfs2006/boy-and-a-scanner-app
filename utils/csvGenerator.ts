
import { ScanResult, TripResult } from '../types';

export type ExportResult =
  | { ok: true; filename: string; count: number }
  | { ok: false; message: string };

export type SmartExportResult =
  | { ok: true; filename: string; count: number }
  | { ok: false; message: string };

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
  (data.agencies || []).forEach(agency => {
    (agency.frequencies || []).forEach(freq => {
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
  (data.trunkedSystems || []).forEach(sys => {
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
const downloadCsv = (content: string, filename: string, count: number): ExportResult => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  if (link.download === undefined || typeof URL.createObjectURL !== 'function') {
    return { ok: false, message: 'CSV export is not supported in this browser.' };
  }

  let url: string | null = null;

  try {
    url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return { ok: true, filename, count };
  } catch {
    return { ok: false, message: 'Failed to start the CSV download. Please try again.' };
  } finally {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
};

/**
 * Main Export Function
 */
export const generateCSV = (data: ScanResult | TripResult): ExportResult => {
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

  return downloadCsv(csvContent, filename, allRows.length);
};

/**
 * Smart Export — only includes conventional frequencies that have been community-confirmed
 * at least `minConfirmations` times within the past 7 days.
 *
 * @param data         The full ScanResult to filter
 * @param counts       Map of freq → { count, last_heard } from crowdsource service
 * @param minConfirmations  Minimum number of community confirmations required
 */
export const generateSmartCSV = (
  data: ScanResult,
  counts: Map<string, { count: number; last_heard: string | null }>,
  minConfirmations: number = 1
): SmartExportResult => {
  const filteredAgencies = data.agencies
    .map(agency => ({
      ...agency,
      frequencies: agency.frequencies.filter(f => (counts.get(f.freq)?.count ?? 0) >= minConfirmations),
    }))
    .filter(a => a.frequencies.length > 0);

  if (filteredAgencies.length === 0) {
    return {
      ok: false,
      message: `No frequencies found with ${minConfirmations}+ community confirmation${minConfirmations !== 1 ? 's' : ''}. Try lowering the threshold or use the regular CSV export.`,
    };
  }

  const filteredData: ScanResult = {
    ...data,
    agencies: filteredAgencies,
    trunkedSystems: [], // Trunked systems don't have per-frequency confirmation counts
  };

  const allRows = processScanResult(filteredData);
  const totalFreqs = filteredAgencies.reduce((sum, a) => sum + a.frequencies.length, 0);

  const csvContent = [
    `# Smart Export — frequencies with >= ${minConfirmations} community confirmation(s) | Generated ${new Date().toLocaleDateString()}`,
    `# ${totalFreqs} frequencies across ${filteredAgencies.length} agencies`,
    CSV_HEADERS.join(','),
    ...allRows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');

  const filename = `SmartExport_${data.locationName}_min${minConfirmations}conf.csv`.replace(/\s+/g, '_');
  return downloadCsv(csvContent, filename, totalFreqs);
};
