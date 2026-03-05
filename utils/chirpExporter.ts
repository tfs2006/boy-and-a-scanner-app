/**
 * CHIRP CSV export for Boy & A Scanner results.
 * Produces the standard CHIRP "generic CSV" memory format compatible with
 * most dual-band/VHF/UHF transceivers and scanners that CHIRP supports.
 *
 * Format spec: https://chirp.danplanet.com/projects/chirp/wiki/MemoryEditorColumns
 */

import { ScanResult, Agency } from '../types';

const CHIRP_HEADER =
  'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Comment,URCALL,RPT1CALL,RPT2CALL,DVCODE';

function cleanName(raw: string): string {
  // CHIRP name: strip non-alphanumeric (except space/dash), truncate to 8 chars
  return raw.replace(/[^A-Za-z0-9 \-]/g, '').slice(0, 8).trim();
}

function formatFreq(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return '';
  // CHIRP expects MHz with 6 decimal places
  return n.toFixed(6);
}

function inferMode(freqMhz: number): string {
  // P25 systems commonly operated in NFM bandwidth channels on UHF/700/800
  if (freqMhz >= 380) return 'NFM';
  return 'FM';
}

function agencyShortName(name: string): string {
  // Try to abbreviate to fit 8 chars: first letters of each word if too long
  const cleaned = cleanName(name);
  if (cleaned.length <= 8) return cleaned;
  const abbrev = name
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 8);
  return abbrev;
}

export function exportChirpCSV(data: ScanResult): void {
  const rows: string[] = [CHIRP_HEADER];
  let location = 0;

  // Collect from conventional agencies
  for (const agency of data.agencies) {
    const nameTag = agencyShortName(agency.name);
    for (const freq of agency.frequencies) {
      const freqStr = formatFreq(freq.freq);
      if (!freqStr) continue;
      const freqMhz = parseFloat(freq.freq);
      const mode = inferMode(freqMhz);
      const comment = [agency.name, freq.description, freq.alphaTag]
        .filter(Boolean)
        .join(' — ')
        .replace(/"/g, "'")
        .slice(0, 200);
      rows.push(
        `${location},${nameTag},${freqStr},,0.000000,,88.5,88.5,023,NN,${mode},5.00,,"${comment}",,,,`
      );
      location++;
    }
  }

  // Collect control channels from trunked systems
  for (const sys of data.trunkedSystems) {
    const nameTag = agencyShortName(sys.name);
    const controlFreqs = sys.frequencies.filter(f => f.use === 'Control' || !f.use);
    for (const ccFreq of controlFreqs) {
      const freqStr = formatFreq(ccFreq.freq);
      if (!freqStr) continue;
      const freqMhz = parseFloat(ccFreq.freq);
      const mode = inferMode(freqMhz);
      const comment = `${sys.name} Control Channel`.replace(/"/g, "'").slice(0, 200);
      rows.push(
        `${location},${nameTag},${freqStr},,0.000000,,88.5,88.5,023,NN,${mode},5.00,,"${comment}",,,,`
      );
      location++;
    }
  }

  if (location === 0) {
    alert('No frequencies to export in CHIRP format.');
    return;
  }

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.locationName.replace(/[^a-z0-9]/gi, '_')}_chirp.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
