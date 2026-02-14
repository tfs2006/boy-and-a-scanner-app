
import React from 'react';
import { ScanResult, Agency, TrunkedSystem } from '../types';
import { Radio, Shield, Flame, Activity, Hash, Zap, CheckCircle2, AlertTriangle, SearchCheck, Signal } from 'lucide-react';

interface FrequencyDisplayProps {
  data: ScanResult;
}

const AgencyCard: React.FC<{ agency: Agency }> = ({ agency }) => {
  const getIcon = (cat: string) => {
    const c = (cat || '').toLowerCase();
    if (c.includes('police') || c.includes('sheriff') || c.includes('law')) return <Shield className="w-5 h-5 text-blue-400" />;
    if (c.includes('fire')) return <Flame className="w-5 h-5 text-red-400" />;
    if (c.includes('ems') || c.includes('medical')) return <Activity className="w-5 h-5 text-green-400" />;
    return <Radio className="w-5 h-5 text-gray-400" />;
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
          <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 font-mono-tech">
            <tr>
              <th className="px-4 py-3">Freq (MHz)</th>
              <th className="px-4 py-3">Tone</th>
              <th className="px-4 py-3">Alpha</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {freqs.map((freq, idx) => (
              <tr key={idx} className="hover:bg-slate-700/30 transition-colors">
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
              </tr>
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
          <Hash className="w-5 h-5 text-purple-400" />
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
          <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 bg-slate-900 font-mono-tech z-10">
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
              <tr key={idx} className="hover:bg-slate-700/30 transition-colors">
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const FrequencyDisplay: React.FC<FrequencyDisplayProps> = ({ data }) => {
  // Defensive checks: Ensure arrays exist
  const agencies = data.agencies || [];
  const systems = data.trunkedSystems || [];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-slate-800/30 border border-slate-700/50 rounded-lg">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400 fill-amber-400/20" />
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
            <div className="text-2xl font-mono-tech text-blue-400">{agencies.length}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Agencies</div>
          </div>
          <div className="bg-slate-900 p-3 rounded border border-slate-800 min-w-[100px]">
            <div className="text-2xl font-mono-tech text-purple-400">{systems.length}</div>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
            <Radio className="w-5 h-5 text-slate-400" />
            <h3 className="text-xl font-semibold text-slate-200">Conventional Frequencies</h3>
          </div>
          {agencies.length > 0 ? (
            agencies.map((agency, i) => <AgencyCard key={i} agency={agency} />)
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
          {systems.length > 0 ? (
            systems.map((sys, i) => <TrunkedSystemCard key={i} system={sys} />)
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
