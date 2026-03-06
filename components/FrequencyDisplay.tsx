
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScanResult, Agency, TrunkedSystem, FrequencyConfirmationCount } from '../types';
import { Radio, Shield, Flame, Activity, Hash, Zap, CheckCircle2, AlertTriangle, SearchCheck, Signal, Ear, Loader2, SlidersHorizontal, X, Search, Download } from 'lucide-react';
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

function getFrequencyRowKey(freq: string, agencyName: string): string {
  return `${agencyName.trim().toLowerCase()}::${freq.trim()}`;
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
                      count={counts.get(getFrequencyRowKey(freq.freq, agency.name))?.count ?? 0}
                      lastHeard={counts.get(getFrequencyRowKey(freq.freq, agency.name))?.last_heard ?? null}
                      confirmed={confirmedSet.has(getFrequencyRowKey(freq.freq, agency.name))}
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
                      count={counts.get(getFrequencyRowKey(freq.freq, agency.name))?.count ?? 0}
                      lastHeard={counts.get(getFrequencyRowKey(freq.freq, agency.name))?.last_heard ?? null}
                      confirmed={confirmedSet.has(getFrequencyRowKey(freq.freq, agency.name))}
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

import { TalkgroupTagType } from '../types';

// ---------------------------------------------------------------------------
// Talkgroup tag-type styling
// ---------------------------------------------------------------------------
const TAG_TYPE_CONFIG: Record<TalkgroupTagType, { label: string; cls: string }> = {
  dispatch:    { label: 'Dispatch',    cls: 'bg-red-900/40 border-red-500/50 text-red-400' },
  tactical:    { label: 'Tactical',    cls: 'bg-amber-900/40 border-amber-500/50 text-amber-400' },
  talkthrough: { label: 'Talk-Around', cls: 'bg-emerald-900/40 border-emerald-500/50 text-emerald-400' },
  supervision: { label: 'Supervision', cls: 'bg-blue-900/40 border-blue-500/50 text-blue-400' },
  data:        { label: 'Data',        cls: 'bg-slate-800 border-slate-600 text-slate-400' },
  unknown:     { label: '',            cls: '' },
};

const TalkgroupTagBadge: React.FC<{ tagType?: TalkgroupTagType }> = ({ tagType }) => {
  if (!tagType || tagType === 'unknown') return null;
  const cfg = TAG_TYPE_CONFIG[tagType];
  return (
    <span className={`text-[9px] font-bold font-mono-tech px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const TG_FILTER_OPTIONS: Array<{ key: TalkgroupTagType | 'all'; label: string }> = [
  { key: 'all',        label: 'All' },
  { key: 'dispatch',   label: 'Dispatch' },
  { key: 'tactical',   label: 'Tactical' },
  { key: 'supervision',label: 'Supervision' },
  { key: 'talkthrough',label: 'Talk-Around' },
  { key: 'data',       label: 'Data' },
];

const TrunkedSystemCard: React.FC<{ system: TrunkedSystem }> = ({ system }) => {
  const talkgroups = system.talkgroups || [];
  const frequencies = system.frequencies || [];

  const [tgFilter, setTgFilter] = useState<TalkgroupTagType | 'all'>('all');

  // Determine which tag types are actually present in this system
  const presentTagTypes = useMemo(() => {
    const s = new Set<TalkgroupTagType>();
    talkgroups.forEach(tg => { if (tg.tagType && tg.tagType !== 'unknown') s.add(tg.tagType); });
    return s;
  }, [talkgroups]);

  const filteredTGs = useMemo(() =>
    tgFilter === 'all' ? talkgroups : talkgroups.filter(tg => tg.tagType === tgFilter),
  [talkgroups, tgFilter]);

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

        {/* Talkgroup channel-type filter — only show when classified TGs exist */}
        {presentTagTypes.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono-tech text-slate-500 uppercase tracking-wider mr-1">Channel type:</span>
            {TG_FILTER_OPTIONS.filter(o => o.key === 'all' || presentTagTypes.has(o.key as TalkgroupTagType)).map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTgFilter(opt.key as TalkgroupTagType | 'all')}
                className={`px-2.5 py-1 rounded-full border text-[10px] font-bold font-mono-tech transition-all ${
                  tgFilter === opt.key
                    ? opt.key === 'all'
                      ? 'bg-slate-600 border-slate-400 text-white'
                      : TAG_TYPE_CONFIG[opt.key as TalkgroupTagType].cls
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                }`}
              >
                {opt.label}
                {opt.key !== 'all' && tgFilter !== opt.key && (
                  <span className="ml-1 opacity-50">
                    {talkgroups.filter(tg => tg.tagType === opt.key).length}
                  </span>
                )}
              </button>
            ))}
            {tgFilter !== 'all' && (
              <span className="text-[10px] font-mono-tech text-slate-500 ml-1">
                {filteredTGs.length}/{talkgroups.length} shown
              </span>
            )}
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
            {filteredTGs.map((tg, idx) => (
              <React.Fragment key={idx}>
                {/* Desktop Row */}
                <tr className="hidden md:table-row hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-mono-tech text-purple-300 font-bold">{tg.dec}</td>
                  <td className="px-4 py-3 font-mono-tech text-xs">{tg.mode}</td>
                  <td className="px-4 py-3 font-medium text-slate-200">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {tg.alphaTag}
                      <TalkgroupTagBadge tagType={tg.tagType} />
                    </div>
                  </td>
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
                    <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-200">{tg.alphaTag}</span>
                      <TalkgroupTagBadge tagType={tg.tagType} />
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

  // --- Text search within results ---
  const [searchText, setSearchText] = useState('');

  // --- Frequency range filter ---
  const freqBounds = useMemo(() => {
    const vals = agencies.flatMap(a => a.frequencies.map(f => parseFloat(f.freq))).filter(v => !isNaN(v));
    if (vals.length === 0) return null;
    const lo = Math.floor(Math.min(...vals) / 5) * 5;
    const hi = Math.ceil(Math.max(...vals) / 5) * 5;
    return lo < hi ? [lo, hi] as [number, number] : null;
  }, [data]);
  const [freqRange, setFreqRange] = useState<[number, number] | null>(null);

  // Reset filters and search whenever the result data changes (new search)
  useEffect(() => {
    setActiveFilters(new Set());
    setSearchText('');
    setFreqRange(null); // resets to full bounds
  }, [data]);

  const activeLow  = freqRange?.[0] ?? freqBounds?.[0] ?? 0;
  const activeHigh = freqRange?.[1] ?? freqBounds?.[1] ?? 999999;
  const rangeActive = freqBounds !== null && (activeLow !== freqBounds[0] || activeHigh !== freqBounds[1]);

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
    const needle = searchText.trim().toLowerCase();
    const activeConvKeys = CONV_FILTER_KEYS.filter(k => activeFilters.has(k));

    return agencies
      .map(agency => {
        let freqs = agency.frequencies || [];

        // Apply system-type filter
        if (activeFilters.size > 0 && activeConvKeys.length > 0) {
          freqs = freqs.filter(f => activeConvKeys.some(k => freqMatchesFilter(f, k)));
        } else if (activeFilters.size > 0 && activeConvKeys.length === 0) {
          freqs = []; // Only system-type filters active, no conv keys match
        }

        // Apply frequency range filter
        if (freqBounds) {
          freqs = freqs.filter(f => {
            const v = parseFloat(f.freq);
            return isNaN(v) || (v >= activeLow && v <= activeHigh);
          });
        }

        // Apply text search
        if (needle) {
          const agencyMatch = agency.name.toLowerCase().includes(needle) || agency.category.toLowerCase().includes(needle);
          if (agencyMatch) {
            // Whole agency matches name/category — keep all its (already type-filtered) freqs
          } else {
            freqs = freqs.filter(f =>
              f.freq.includes(needle) ||
              (f.alphaTag || '').toLowerCase().includes(needle) ||
              (f.description || '').toLowerCase().includes(needle) ||
              (f.mode || '').toLowerCase().includes(needle)
            );
          }
        }

        return { ...agency, frequencies: freqs };
      })
      .filter(a => a.frequencies.length > 0);
  }, [agencies, activeFilters, searchText, activeLow, activeHigh, freqBounds]);

  // Compute filtered trunked systems
  const filteredSystems = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const activeSysKeys = SYS_FILTER_KEYS.filter(k => activeFilters.has(k));

    let filtered = systems;

    // Apply system-type filter
    if (activeFilters.size > 0) {
      if (activeSysKeys.length === 0) {
        filtered = [];
      } else {
        filtered = filtered.filter(sys => activeSysKeys.some(k => systemMatchesFilter(sys, k)));
      }
    }

    // Apply text search
    if (needle) {
      filtered = filtered.filter(sys => {
        if (sys.name.toLowerCase().includes(needle) || (sys.type || '').toLowerCase().includes(needle) || (sys.location || '').toLowerCase().includes(needle)) return true;
        return (sys.talkgroups || []).some(tg =>
          (tg.alphaTag || '').toLowerCase().includes(needle) ||
          (tg.description || '').toLowerCase().includes(needle) ||
          String(tg.dec).includes(needle)
        );
      });
    }

    return filtered;
  }, [systems, activeFilters, searchText]);

  // Load batch counts when result changes
  useEffect(() => {
    if (!locationQuery) return;
    const allRows = agencies.flatMap(a => a.frequencies.map(f => ({ frequency: f.freq, agencyName: a.name })));
    if (allRows.length === 0) return;
    getBatchConfirmationCounts(allRows, locationQuery).then(setCounts);
  }, [data, locationQuery]);

  const handleConfirm = useCallback(async (freq: string, agencyName: string) => {
    const success = await logConfirmation(freq, locationQuery, agencyName);
    if (success) {
      const rowKey = getFrequencyRowKey(freq, agencyName);
      setConfirmedSet(prev => new Set(prev).add(rowKey));
      setCounts(prev => {
        const updated = new Map(prev);
        const existing = updated.get(rowKey);
        updated.set(rowKey, {
          frequency: freq,
          location_query: locationQuery,
          count: (existing?.count ?? 0) + 1,
          last_heard: new Date().toISOString(),
        });
        return updated;
      });
    }
  }, [locationQuery]);

  const handleSmartExport = useCallback(async (minConfirmations: number) => {
    const { generateSmartCSV } = await import('../utils/csvGenerator');
    generateSmartCSV(data, counts, minConfirmations);
  }, [data, counts]);

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
          {/* Smart Export — only shown when community confirmations exist */}
          {counts.size > 0 && (
            <div className="bg-slate-900 p-3 rounded border border-slate-800 flex flex-col items-center justify-between gap-1 min-w-[110px]">
              <div className="text-xs text-emerald-400 font-bold font-mono-tech uppercase">Smart Export</div>
              <div className="flex gap-1">
                {[1, 3, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { void handleSmartExport(n); }}
                    title={`Export only frequencies heard ${n}+ time${n !== 1 ? 's' : ''} by the community`}
                    className="flex items-center gap-0.5 px-1.5 py-1 rounded bg-emerald-900/40 border border-emerald-600/40 text-emerald-400 hover:bg-emerald-800/60 hover:text-white transition-colors text-[10px] font-bold font-mono-tech"
                  >
                    <Download className="w-2.5 h-2.5" />
                    {n}+
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-slate-500">confirmations</div>
            </div>
          )}
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

      {data.dataQualityWarnings && data.dataQualityWarnings.length > 0 && (
        <div className="bg-amber-900/10 border border-amber-700/30 rounded p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-amber-500 uppercase font-mono-tech mb-1">Data Quality Notice — AI Source</h4>
            <ul className="text-xs text-slate-400 space-y-0.5">
              {data.dataQualityWarnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
            <p className="text-[10px] text-slate-500 mt-1">Verify frequencies before programming your scanner.</p>
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

      {/* Search + range filter row */}
      <div className="flex flex-col gap-3">
        {/* Text search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search agencies, frequencies, alpha tags, talkgroups…"
            className="w-full pl-9 pr-8 py-2.5 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 font-mono-tech focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Frequency range slider — only show when 2+ distinct frequency bands exist */}
        {freqBounds && (
          <div className={`px-4 py-3 rounded-lg border transition-colors ${
            rangeActive ? 'bg-cyan-900/10 border-cyan-700/40' : 'bg-slate-900/40 border-slate-700'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Signal className="w-3 h-3" /> Frequency Band
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono-tech font-bold text-amber-400">
                  {activeLow.toFixed(1)} – {activeHigh.toFixed(1)} MHz
                </span>
                {rangeActive && (
                  <button
                    type="button"
                    onClick={() => setFreqRange(null)}
                    className="text-[10px] font-mono-tech text-slate-500 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" /> Reset
                  </button>
                )}
              </div>
            </div>
            {/* Dual-handle slider using two stacked range inputs */}
            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1 bg-slate-700 rounded-full">
                <div
                  className="absolute h-1 bg-cyan-500 rounded-full"
                  style={{
                    left: `${((activeLow - freqBounds[0]) / (freqBounds[1] - freqBounds[0])) * 100}%`,
                    right: `${100 - ((activeHigh - freqBounds[0]) / (freqBounds[1] - freqBounds[0])) * 100}%`,
                  }}
                />
              </div>
              <input
                type="range"
                min={freqBounds[0]}
                max={freqBounds[1]}
                step={0.5}
                value={activeLow}
                onChange={e => {
                  const v = Math.min(parseFloat(e.target.value), activeHigh - 0.5);
                  setFreqRange([v, activeHigh]);
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              />
              <input
                type="range"
                min={freqBounds[0]}
                max={freqBounds[1]}
                step={0.5}
                value={activeHigh}
                onChange={e => {
                  const v = Math.max(parseFloat(e.target.value), activeLow + 0.5);
                  setFreqRange([activeLow, v]);
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>
            <div className="flex justify-between text-[9px] font-mono-tech text-slate-600 mt-1">
              <span>{freqBounds[0]} MHz</span>
              <span>{freqBounds[1]} MHz</span>
            </div>
          </div>
        )}
      </div>

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
          ) : (activeFilters.size > 0 || searchText) ? (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No conventional agencies match the active {searchText ? 'search' : 'filter'}.
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
          ) : (activeFilters.size > 0 || searchText) ? (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-lg text-slate-500">
              No trunked systems match the active {searchText ? 'search' : 'filter'}.
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
