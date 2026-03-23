import type { Agency, ScanResult, TrunkedSystem } from '../types';

export type SystemFilterKey =
  | 'analog'
  | 'p25-conv' | 'p25-phase1' | 'p25-phase2'
  | 'dmr-conv' | 'dmr-trunked'
  | 'nxdn-conv' | 'nxdn-trunked'
  | 'edacs' | 'ltr' | 'motorola';

export const CONVENTIONAL_SYSTEM_FILTER_KEYS: SystemFilterKey[] = ['analog', 'p25-conv', 'dmr-conv', 'nxdn-conv'];
export const TRUNKED_SYSTEM_FILTER_KEYS: SystemFilterKey[] = ['p25-phase1', 'p25-phase2', 'dmr-trunked', 'nxdn-trunked', 'edacs', 'ltr', 'motorola'];

export function frequencyMatchesSystemFilter(freq: Agency['frequencies'][number], key: SystemFilterKey): boolean {
  const mode = (freq.mode || '').toUpperCase();

  switch (key) {
    case 'analog':
      return /^(FM|FMN|NFM|AM|AN|WFM|USB|LSB|CW|FB|MO)$/.test(mode) && !freq.nac && !freq.colorCode && !freq.ran;
    case 'p25-conv':
      return (/P25|APCO/.test(mode) || !!freq.nac) && !/LTR|EDACS/i.test(mode);
    case 'dmr-conv':
      return /DMR/.test(mode) || !!freq.colorCode;
    case 'nxdn-conv':
      return /NXDN|NXD/.test(mode) || !!freq.ran;
    default:
      return false;
  }
}

export function trunkedSystemMatchesFilter(system: TrunkedSystem, key: SystemFilterKey): boolean {
  const type = (system.type || '').toLowerCase();

  switch (key) {
    case 'p25-phase1':
      return /p25/.test(type) && !/phase\s*i{2}|phase\s*2|tdma/.test(type);
    case 'p25-phase2':
      return /phase\s*i{2}|phase\s*2|tdma/.test(type);
    case 'dmr-trunked':
      return /\bdmr\b/.test(type);
    case 'nxdn-trunked':
      return /nxdn|nexedge/.test(type);
    case 'edacs':
      return /edacs/.test(type);
    case 'ltr':
      return /\bltr\b/.test(type);
    case 'motorola':
      return /motorola|type\s*i/.test(type);
    default:
      return false;
  }
}

export function detectSystemFilters(data: ScanResult): Set<SystemFilterKey> {
  const present = new Set<SystemFilterKey>();

  for (const agency of data.agencies || []) {
    for (const freq of agency.frequencies || []) {
      for (const key of CONVENTIONAL_SYSTEM_FILTER_KEYS) {
        if (frequencyMatchesSystemFilter(freq, key)) present.add(key);
      }
    }
  }

  for (const system of data.trunkedSystems || []) {
    for (const key of TRUNKED_SYSTEM_FILTER_KEYS) {
      if (trunkedSystemMatchesFilter(system, key)) present.add(key);
    }
  }

  return present;
}