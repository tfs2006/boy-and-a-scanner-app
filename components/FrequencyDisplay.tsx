
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScanResult, Agency, TrunkedSystem, FrequencyConfirmationCount } from '../types';
import { Radio, Shield, Flame, Activity, Hash, Zap, CheckCircle2, AlertTriangle, SearchCheck, Signal, Ear, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { logConfirmation, getBatchConfirmationCounts } from '../services/crowdsourceService';

// ---------------------------------------------------------------------------
// System-type filter taxonomy
// ---------------------------------------------------------------------------
type SystemFilterKey =
  | 'analog'
  | 'p25-conv' | 'p25-phase1' | 'p25-phase2'
  | 'dmr-conv' | 'dmr-trunked'
  | 'nxdn-conv' | 'nxdn-trunked'
  | 'edacs' | 'ltr' | 'motorola';

interface SystemFilterConfig {
  label: string;
  sublabel?: string;
  activeClass: string;  // Tailwind classes when selected
  group: string;        // visual grouping
}

const SYSTEM_FILTER_CONFIG: Record<SystemFilterKey, SystemFilterConfig> = {
  'analog':       { label: 'Analog',   sublabel: 'FM / AM',       activeClass: 'bg-slate-600   border-slate-400   text-white',         group: 'analog' },
  'p25-conv':     { label: 'P25',      sublabel: 'Conventional',  activeClass: 'bg-blue-800/70 border-blue-400    text-blue-100',      group: 'p25' },
  'p25-phase1':   { label: 'P25',      sublabel: 'Phase I',       activeClass: 'bg-blue-700/70 border-blue-300    text-blue-100',      group: 'p25' },
  'p25-phase2':   { label: 'P25',      sublabel: 'Phase II',      activeClass: 'bg-cyan-800/70 border-cyan-400    text-cyan-100',      group: 'p25' },
  'dmr-conv':     { label: 'DMR',      sublabel: 'Conventional',  activeClass: 'bg-purple-800/70 border-purple-400 text-purple-100',   group: 'dmr' },
  'dmr-trunked':  { label: 'DMR',      sublabel: 'Trunked',       activeClass: 'bg-purple-700/70 border-purple-300 text-purple-100',   group: 'dmr' },
  'nxdn-conv':    { label: 'NXDN',     sublabel: 'Conventional',  activeClass: 'bg-orange-800/70 border-orange-400 text-orange-100',   group: 'nxdn' },
  'nxdn-trunked': { label: 'NXDN',     sublabel: 'Trunked',       activeClass: 'bg-orange-700/70 border-orange-300 text-orange-100',   group: 'nxdn' },
  'edacs':        { label: 'EDACS',                               activeClass: 'bg-pink-800/70   border-pink-400    text-pink-100',     group: 'other' },
  'ltr':          { label: 'LTR',                                 activeClass: 'bg-rose-800/70   border-rose-400    text-rose-100',     group: 'other' },
  'motorola':     { label: 'Motorola', sublabel: 'Type I/II',     activeClass: 'bg-emerald-800/70 border-emerald-400 text-emerald-100', group: 'other' },
};

// Ordered for display (grouped)
const FILTER_ORDER: SystemFilterKey[] = [
  'analog',
  'p25-conv', 'p25-phase1', 'p25-phase2',
  'dmr-conv', 'dmr-trunked',
  'nxdn-conv', 'nxdn-trunked',
  'edacs', 'ltr', 'motorola',
];

// Keys that apply to individual agency frequencies
const CONV_FILTER_KEYS: SystemFilterKey[] = ['analog', 'p25-conv', 'dmr-conv', 'nxdn-conv'];
// Keys that apply to trunked systems
const SYS_FILTER_KEYS: SystemFilterKey[] = ['p25-phase1', 'p25-phase2', 'dmr-trunked', 'nxdn-trunked', 'edacs', 'ltr', 'motorola'];

function freqMatchesFilter(freq: Agency['frequencies'][number], key: SystemFilterKey): boolean {
  const mode = (freq.mode || '').toUpperCase();
  switch (key) {
    case 'analog':
      // Analog: FM/AM-family modes with no digital identifiers
      return /^(FM|FMN|NFM|AM|AN|WFM|USB|LSB|CW|FB|MO)$/.test(mode) && !freq.nac && !freq.colorCode && !freq.ran;
    case 'p25-conv':
      return /P25|APCO/.test(mode) || (!!freq.nac && !/LTR|EDACS/i.test(mode));
    case 'dmr-conv':
      return /DMR/.test(mode) || !!freq.colorCode;
    case 'nxdn-conv':
      return /NXDN|NXD/.test(mode) || !!freq.ran;
    default:
      return false;
  }
}

function systemMatchesFilter(system: TrunkedSystem, key: SystemFilterKey): boolean {
  const type = (system.type || '').toLowerCase();
  switch (key) {
    case 'p25-phase1':   return /p25/.test(type) && !/phase\s*i{2}|phase\s*2|tdma/.test(type);
    case 'p25-phase2':   return /phase\s*i{2}|phase\s*2|tdma/.test(type);
    case 'dmr-trunked':  return /\bdmr\b/.test(type);
    case 'nxdn-trunked': return /nxdn|nexedge/.test(type);
    case 'edacs':        return /edacs/.test(type);
    case 'ltr':          return /\bltr\b/.test(type);
    case 'motorola':     return /motorola|type\s*i/.test(type);
    default:             return false;
  }
}

/** Scan data and return only the filter keys that are actually present */
function detectPresentFilters(data: ScanResult): Set<SystemFilterKey> {
  const present = new Set<SystemFilterKey>();
  for (const agency of data.agencies || []) {
    for (const freq of agency.frequencies || []) {
      for (const key of CONV_FILTER_KEYS) {
        if (freqMatchesFilter(freq, key)) present.add(key);
      }
    }
  }
  for (const sys of data.trunkedSystems || []) {
    for (const key of SYS_FILTER_KEYS) {
      if (systemMatchesFilter(sys, key)) present.add(key);
    }
  }
  return present;
}

// ---------------------------------------------------------------------------
// System Type Filter UI
// ---------------------------------------------------------------------------
const SystemTypeFilter: React.FC<{
  presentFilters: Set<SystemFilterKey>;
  activeFilters: Set<SystemFilterKey>;
  onToggle: (key: SystemFilterKey) => void;
  onClearAll: () => void;
  agencyCountTotal: number;
  agencyCountFiltered: number;
  systemCountTotal: number;
  systemCountFiltered: number;
}> = ({ presentFilters, activeFilters, onToggle, onClearAll, agencyCountTotal, agencyCountFiltered, systemCountTotal, systemCountFiltered }) => {
  const [open, setOpen] = useState(false);

  if (presentFilters.size <= 1) return null; // Not useful to filter if only one type

  const hasActiveFilter = activeFilters.size > 0;
  const isFiltering = hasActiveFilter && (agencyCountFiltered < agencyCountTotal || systemCountFiltered < systemCountTotal);

  // Build chip groups for display
  const visibleByGroup: Partial<Record<string, SystemFilterKey[]>> = {};
  for (const key of FILTER_ORDER) {
    if (!presentFilters.has(key)) continue;
    const cfg = SYSTEM_FILTER_CONFIG[key];
    if (!visibleByGroup[cfg.group]) visibleByGroup[cfg.group] = [];
    visibleByGroup[cfg.group]!.push(key);
  }

  return (
    <div className="bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-mono-tech uppercase tracking-wider hover:bg-slate-800/50 transition-colors"
      >
        <span className="flex items-center gap-2 text-slate-400 hover:text-white">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          System Type Filter
          {isFiltering && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/40 border border-cyan-500/30 text-cyan-400 normal-case font-normal">
              {agencyCountFiltered}/{agencyCountTotal} agencies · {systemCountFiltered}/{systemCountTotal} systems shown
            </span>
          )}
        </span>
        <span className="text-slate-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-700/50 animate-fade-in">
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {/* "All" reset chip */}
            <button
              type="button"
              onClick={onClearAll}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold font-mono-tech transition-all ${
                !hasActiveFilter
                  ? 'bg-cyan-600 border-cyan-500 text-white shadow-md shadow-cyan-900/30'
                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              All Systems
            </button>

            {/* Chips grouped by technology family */}
            {Object.entries(visibleByGroup).map(([group, keys], gi) => (
              <React.Fragment key={group}>
                {gi > 0 && <div className="w-px bg-slate-700 self-stretch mx-0.5" />}
                <div className="flex flex-wrap gap-2">
                  {keys!.map(key => {
                    const cfg = SYSTEM_FILTER_CONFIG[key];
                    const isActive = activeFilters.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onToggle(key)}
                        className={`flex flex-col items-start px-3 py-1.5 rounded-full border text-xs font-bold font-mono-tech transition-all hover:scale-105 ${
                          isActive
                            ? `${cfg.activeClass} shadow-md`
                            : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        <span>{cfg.label}</span>
                        {cfg.sublabel && (
                          <span className={`text-[9px] font-normal normal-case leading-tight -mt-0.5 ${isActive ? 'opacity-80' : 'text-slate-500'}`}>
                            {cfg.sublabel}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}

            {/* Clear active filters */}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={onClearAll}
                className="flex items-center gap-1 px-2 py-1.5 rounded-full border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 text-xs font-mono-tech transition-colors ml-auto"
                title="Clear all filters"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface FrequencyDisplayProps {
  data: ScanResult;
  locationQuery?: string;
  isLoggedIn?: boolean;
}

interface AgencyCardProps {
  agency: Agency;
  locationQuery: string;
  counts: Map<string, FrequencyConfirmationCount>;
  confirmedSet: Set<string>;
  onConfirm: (freq: string, agencyName: string) => void;
  isLoggedIn: boolean;
}

const HeardItButton: React.FC<{
  freq: string;
  agencyName: string;
  locationQuery: string;
  count: number;
  lastHeard: string | null;
  confirmed: boolean;
  isLoggedIn: boolean;
  onConfirm: (freq: string, agencyName: string) => void;
}> = ({ freq, agencyName, count, lastHeard, confirmed, isLoggedIn, onConfirm }) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (confirmed || loading || !isLoggedIn) return;
    setLoading(true);
    await onConfirm(freq, agencyName);
    setLoading(false);
  };

  const formatLastHeard = (ts: string | null) => {
    if (!ts) return null;
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="flex items-center gap-2">
      {count > 0 && (
        <span className="text-[10px] font-mono-tech text-emerald-400 flex items-center gap-1" title={`Last heard: ${formatLastHeard(lastHeard)}`}>
          <Ear className="w-3 h-3" />
          {count}w
        </span>
      )}
      <button
        onClick={handleClick}
        disabled={confirmed || loading || !isLoggedIn}
        title={!isLoggedIn ? 'Sign in to confirm' : confirmed ? 'Already confirmed this session' : 'I heard this active!'}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono-tech transition-all
          ${confirmed
            ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/40 cursor-default'
            : !isLoggedIn
              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              : 'bg-slate-800 text-slate-400 border border-slate-600 hover:bg-emerald-900/30 hover:text-emerald-400 hover:border-emerald-500/40 cursor-pointer'
          }`}
      >
        {loading
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <Ear className="w-3 h-3" />
        }
        {confirmed ? 'Heard' : 'Heard It'}
      </button>
    </div>
  );
};

const AgencyCard: React.FC<AgencyCardProps> = ({ agency, locationQuery, counts, confirmedSet, onConfirm, isLoggedIn }) => {
  const getIcon = (cat: string) => {
    const c = (cat || '').toLowerCase();
    if (c.includes('police') || c.includes('sheriff') || c.includes('law')) return <Shield className="w-5 h-5 text-blue-400" title="Law Enforcement" />;
    if (c.includes('fire')) return <Flame className="w-5 h-5 text-red-400" title="Fire / Rescue" />;
    if (c.includes('ems') || c.includes('medical')) return <Activity className="w-5 h-5 text-green-400" title="EMS / Medical" />;
    return <Radio className="w-5 h-5 text-gray-400" title="Other Service" />;
  };

  const freqs = agency.frequencies || [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden mb-6 shadow-lg backdrop-blur-sm">
      <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3">
        {getIcon(agency.category)}
        <h3 className="text-lg font-bold text-slate-100 font-mono-tech uppercase tracking-wider">{agency.name}</h3>
        <span className="ml-auto text-xs px-2 py-1 rounded-full bg-slate-700 text-slate-300 font-mono-tech">{agency.category}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 font-mono-tech hidden md:table-header-group">
            <tr>
              <th className="px-4 py-3">Freq (MHz)</th>
              <th className="px-4 py-3">Tone</th>
              <th className="px-4 py-3">Alpha</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {freqs.map((freq, idx) => (
              <React.Fragment key={idx}>
                {/* Desktop Row */}
                <tr className="hidden md:table-row hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-mono-tech text-amber-400 font-bold">{freq.freq}</td>
                  <td className="px-4 py-3 font-mono-tech text-slate-400">
                    {freq.tone || 'CSQ'}
                    {/* Digital Badges */}
                    {freq.colorCode && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/50 text-purple-400 border border-purple-500/30" title="DMR Color Code">
                        CC:{freq.colorCode}
                      </span>
                    )}
                    {freq.nac && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900/50 text-blue-400 border border-blue-500/30" title="P25 NAC">
                        NAC:{freq.nac}
                      </span>
                    )}
                    {freq.ran && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-900/50 text-orange-400 border border-orange-500/30" title="NXDN RAN">
                        RAN:{freq.ran}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-200">{freq.alphaTag || '-'}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-slate-700 text-cyan-400 border border-slate-600">{freq.mode}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{freq.description}</td>
                  <td className="px-4 py-3">
                    <HeardItButton
                      freq={freq.freq}
                      agencyName={agency.name}
                      locationQuery={locationQuery}
                      count={counts.get(freq.freq)?.count ?? 0}
                      lastHeard={counts.get(freq.freq)?.last_heard ?? null}
                      confirmed={confirmedSet.has(freq.freq)}
                      isLoggedIn={isLoggedIn}
                      onConfirm={onConfirm}
                    />
                  </td>
                </tr>

                {/* Mobile Card View */}
                <tr className="md:hidden border-b border-slate-700/50">
                  <td colSpan={6} className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col">
                        <span className="text-xl font-mono-tech font-bold text-amber-400">{freq.freq}</span>
                        <span className="text-xs font-mono-tech text-slate-500">{freq.mode} {freq.tone ? `• ${freq.tone}` : ''}</span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {(freq.colorCode || freq.nac || freq.ran) && (
                          <>
                            {freq.colorCode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-400 border border-purple-500/30 font-bold">CC:{freq.colorCode}</span>}
                            {freq.nac && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-500/30 font-bold">NAC:{freq.nac}</span>}
                            {freq.ran && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-400 border border-orange-500/30 font-bold">RAN:{freq.ran}</span>}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mb-1">
                      <span className="font-bold text-slate-200 block">{freq.alphaTag || 'No Tag'}</span>
                    </div>
                    <div className="text-sm text-slate-400 mb-2">
                      {freq.description}
                    </div>
                    <HeardItButton
                      freq={freq.freq}
                      agencyName={agency.name}
                      locationQuery={locationQuery}
                      count={counts.get(freq.freq)?.count ?? 0}
                      lastHeard={counts.get(freq.freq)?.last_heard ?? null}
                      confirmed={confirmedSet.has(freq.freq)}
                      isLoggedIn={isLoggedIn}
                      onConfirm={onConfirm}
                    />
                  </td>
                </tr>
              </React.Fragment>
            ))}
            {freqs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-slate-500 italic">No conventional frequencies listed. Likely trunked.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TrunkedSystemCard: React.FC<{ system: TrunkedSystem }> = ({ system }) => {
  const talkgroups = system.talkgroups || [];
  const frequencies = system.frequencies || [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden mb-6 shadow-lg backdrop-blur-sm">
      <div className="p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Hash className="w-5 h-5 text-purple-400" title="Trunked System" />
          <div>
            <h3 className="text-lg font-bold text-slate-100 font-mono-tech uppercase tracking-wider">{system.name}</h3>
            <p className="text-xs text-purple-300 font-mono-tech">{system.type} • {system.location}</p>
          </div>
        </div>

        {/* Control Channel Display */}
        {frequencies.length > 0 && (
          <div className="bg-slate-950/50 rounded border border-slate-800 p-3 flex flex-wrap gap-2 items-center">
            <div className="text-xs font-bold text-slate-400 uppercase font-mono-tech mr-2 flex items-center gap-1">
              <Signal className="w-3 h-3" /> System Freqs:
            </div>
            {frequencies.map((f, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 border border-slate-700">
                <span className={`text-xs font-mono-tech font-bold ${f.use?.toLowerCase().includes('control') || f.use === 'c' ? 'text-red-400' : 'text-slate-300'}`}>
                  {f.freq}
                </span>
                {f.use && (
                  <span className="text-[9px] text-slate-500 uppercase">
                    {f.use.substring(0, 1)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 bg-slate-900 font-mono-tech z-10 hidden md:table-header-group">
            <tr>
              <th className="px-4 py-3">Dec ID</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Alpha</th>
              <th className="px-4 py-3">Tag</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {talkgroups.map((tg, idx) => (
              <React.Fragment key={idx}>
                {/* Desktop Row */}
                <tr className="hidden md:table-row hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-mono-tech text-purple-300 font-bold">{tg.dec}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs">{tg.mode}</td>
                  <td className="px-4 py-3 font-medium text-slate-200">{tg.alphaTag}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full border border-slate-600 bg-slate-800 text-slate-400">
                      {tg.tag}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{tg.description}</td>
                </tr>

                {/* Mobile Card */}
                <tr className="md:hidden border-b border-slate-700/50">
                  <td colSpan={5} className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-mono-tech font-bold text-purple-300">ID: {tg.dec}</span>
                        <span className="text-xs font-mono-tech text-slate-500 px-1.5 py-0.5 rounded border border-slate-700">{tg.mode}</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600 bg-slate-800 text-slate-400 uppercase">
                        {tg.tag}
                      </span>
                    </div>
                    <div className="mb-1">
                      <span className="font-bold text-slate-200 block">{tg.alphaTag}</span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {tg.description}
                    </div>
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const FrequencyDisplay: React.FC<FrequencyDisplayProps> = ({ data, locationQuery = '', isLoggedIn = false }) => {
  // Defensive checks: Ensure arrays exist
  const agencies = data.agencies || [];
  const systems = data.trunkedSystems || [];

  // Confirmation counts from DB
  const [counts, setCounts] = useState<Map<string, FrequencyConfirmationCount>>(new Map());
  // Frequencies confirmed this session (prevent double-tapping)
  const [confirmedSet, setConfirmedSet] = useState<Set<string>>(new Set());

  // --- System type filter state ---
  const [activeFilters, setActiveFilters] = useState<Set<SystemFilterKey>>(new Set());

  // Reset filters whenever the result data changes (new search)
  useEffect(() => {
    setActiveFilters(new Set());
  }, [data]);

  // Detect which filter types are actually present in this result
  const presentFilters = useMemo(() => detectPresentFilters(data), [data]);

  const handleFilterToggle = useCallback((key: SystemFilterKey) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleFilterClear = useCallback(() => setActiveFilters(new Set()), []);

  // Compute filtered agencies: keep agencies that have at least one matching frequency
  const filteredAgencies = useMemo(() => {
    if (activeFilters.size === 0) return agencies;
    const activeConvKeys = CONV_FILTER_KEYS.filter(k => activeFilters.has(k));
    if (activeConvKeys.length === 0) return []; // only system-type filters active
    return agencies
      .map(agency => ({
        ...agency,
        frequencies: (agency.frequencies || []).filter(f =>
          activeConvKeys.some(k => freqMatchesFilter(f, k))
        ),
      }))
      .filter(a => a.frequencies.length > 0);
  }, [agencies, activeFilters]);

  // Compute filtered trunked systems
  const filteredSystems = useMemo(() => {
    if (activeFilters.size === 0) return systems;
    const activeSysKeys = SYS_FILTER_KEYS.filter(k => activeFilters.has(k));
    if (activeSysKeys.length === 0) return [];
    return systems.filter(sys => activeSysKeys.some(k => systemMatchesFilter(sys, k)));
  }, [systems, activeFilters]);

  // Load batch counts when result changes
  useEffect(() => {
    if (!locationQuery) return;
    const allFreqs = agencies.flatMap(a => a.frequencies.map(f => f.freq));
    if (allFreqs.length === 0) return;
    getBatchConfirmationCounts(allFreqs, locationQuery).then(setCounts);
  }, [data, locationQuery]);

  const handleConfirm = useCallback(async (freq: string, agencyName: string) => {
    const success = await logConfirmation(freq, locationQuery, agencyName);
    if (success) {
      setConfirmedSet(prev => new Set(prev).add(freq));
      setCounts(prev => {
        const updated = new Map(prev);
        const existing = updated.get(freq);
        updated.set(freq, {
          frequency: freq,
          location_query: locationQuery,
          count: (existing?.count ?? 0) + 1,
          last_heard: new Date().toISOString(),
        });
        return updated;
      });
    }
  }, [locationQuery]);

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-slate-800/30 border border-slate-700/50 rounded-lg">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400 fill-amber-400/20" title="Location Query" />
            {data.locationName}
          </h2>
          <p className="text-slate-400 max-w-2xl text-sm leading-relaxed">{data.summary}</p>

          {data.crossRef && (
            <div className="mt-3 inline-flex items-center gap-3 px-3 py-1.5 bg-slate-900/80 rounded border border-slate-700">
              {data.crossRef.verified ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              <div className="flex flex-col">
                <span className={`text-xs font-bold font-mono-tech uppercase ${data.crossRef.verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {data.crossRef.verified ? 'Verified Accurate' : 'Unverified Data'}
                </span>
                <span className="text-[10px] text-slate-500">
                  Confidence: {data.crossRef.confidenceScore}% • Sources: {data.crossRef.sourcesChecked}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-4 text-center">
          <div className="bg-slate-900 p-3 rounded border border-slate-800 min-w-[100px]">
            <div className="text-2xl font-mono-tech text-blue-400">
              {activeFilters.size > 0 && filteredAgencies.length !== agencies.length
                ? <><span>{filteredAgencies.length}</span><span className="text-sm text-slate-600">/{agencies.length}</span></>
                : agencies.length}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Agencies</div>
          </div>
          <div className="bg-slate-900 p-3 rounded border border-slate-800 min-w-[100px]">
            <div className="text-2xl font-mono-tech text-purple-400">
              {activeFilters.size > 0 && filteredSystems.length !== systems.length
                ? <><span>{filteredSystems.length}</span><span className="text-sm text-slate-600">/{systems.length}</span></>
                : systems.length}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Systems</div>
          </div>
        </div>
      </div>

      {data.crossRef?.notes && (
        <div className="bg-emerald-900/10 border border-emerald-900/30 rounded p-3 flex items-start gap-3">
          <SearchCheck className="w-5 h-5 text-emerald-500 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-emerald-500 uppercase font-mono-tech mb-1">Cross-Reference Report</h4>
            <p className="text-sm text-slate-300">{data.crossRef.notes}</p>
          </div>
        </div>
      )}

      {/* System Type Filter — only rendered when multiple types are present */}
      <SystemTypeFilter
        presentFilters={presentFilters}
        activeFilters={activeFilters}
        onToggle={handleFilterToggle}
        onClearAll={handleFilterClear}
        agencyCountTotal={agencies.length}
        agencyCountFiltered={filteredAgencies.length}
        systemCountTotal={systems.length}
        systemCountFiltered={filteredSystems.length}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
            <Radio className="w-5 h-5 text-slate-400" />
            <h3 className="text-xl font-semibold text-slate-200">Conventional Frequencies</h3>
          </div>
          {filteredAgencies.length > 0 ? (
            filteredAgencies.map((agency, i) => (
              <AgencyCard
                key={i}
                agency={agency}
                locationQuery={locationQuery}
                counts={counts}
                confirmedSet={confirmedSet}
                onConfirm={handleConfirm}
                isLoggedIn={isLoggedIn}
              />
            ))
          ) : activeFilters.size > 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No conventional agencies match the active filter.
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No conventional agencies found via search.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
            <Hash className="w-5 h-5 text-slate-400" />
            <h3 className="text-xl font-semibold text-slate-200">Trunked Systems</h3>
          </div>
          {filteredSystems.length > 0 ? (
            filteredSystems.map((sys, i) => <TrunkedSystemCard key={i} system={sys} />)
          ) : activeFilters.size > 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No trunked systems match the active filter.
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No trunked systems found via search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
