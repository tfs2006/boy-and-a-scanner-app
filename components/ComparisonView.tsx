import React from 'react';
import { ScanResult, Agency, TrunkedSystem } from '../types';
import { X, Shield, Flame, Activity, Radio, Hash, Zap } from 'lucide-react';

interface ComparisonViewProps {
    left: ScanResult;
    right: ScanResult;
    onClose: () => void;
}

const AgencyList: React.FC<{ agencies: Agency[] }> = ({ agencies }) => {
    if (!agencies || agencies.length === 0) return <div className="text-slate-500 italic text-sm">No agencies found.</div>;

    return (
        <div className="space-y-4">
            {agencies.map((agency, idx) => (
                <div key={idx} className="border-b border-slate-700/50 pb-2 last:border-0">
                    <h4 className="font-bold text-slate-300 text-sm">{agency.name}</h4>
                    <div className="text-xs text-slate-500 mb-1">{agency.category}</div>
                    <div className="flex flex-wrap gap-1">
                        {agency.frequencies.slice(0, 5).map((f, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-amber-400 font-mono-tech">
                                {f.freq}
                            </span>
                        ))}
                        {agency.frequencies.length > 5 && (
                            <span className="px-1.5 py-0.5 text-xs text-slate-600">+ {agency.frequencies.length - 5} more</span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

const SystemList: React.FC<{ systems: TrunkedSystem[] }> = ({ systems }) => {
    if (!systems || systems.length === 0) return <div className="text-slate-500 italic text-sm">No trunked systems.</div>;

    return (
        <div className="space-y-4">
            {systems.map((sys, idx) => (
                <div key={idx} className="border-b border-slate-700/50 pb-2 last:border-0">
                    <h4 className="font-bold text-purple-300 text-sm flex items-center gap-1">
                        <Hash className="w-3 h-3" /> {sys.name}
                    </h4>
                    <div className="text-xs text-slate-500">{sys.type}</div>
                </div>
            ))}
        </div>
    );
};

export const ComparisonView: React.FC<ComparisonViewProps> = ({ left, right, onClose }) => {
    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-sm overflow-hidden flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-900 shadow-xl">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Zap className="w-5 h-5 text-cyan-400" />
                    Comparison View
                </h2>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">

                    {/* Left Column */}
                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 md:p-6 overflow-y-auto">
                        <div className="mb-6 pb-4 border-b border-slate-700">
                            <h3 className="text-2xl font-bold text-white mb-1">{left.locationName}</h3>
                            <p className="text-sm text-slate-400 line-clamp-2">{left.summary}</p>
                        </div>

                        <div className="mb-6">
                            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-2">
                                <Shield className="w-4 h-4" /> Conventional Agencies
                            </h4>
                            <AgencyList agencies={left.agencies} />
                        </div>

                        <div>
                            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-2">
                                <Hash className="w-4 h-4" /> Trunked Systems
                            </h4>
                            <SystemList systems={left.trunkedSystems} />
                        </div>
                    </div>

                    {/* Right Column */}
                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 md:p-6 overflow-y-auto">
                        <div className="mb-6 pb-4 border-b border-slate-700">
                            <h3 className="text-2xl font-bold text-white mb-1">{right.locationName}</h3>
                            <p className="text-sm text-slate-400 line-clamp-2">{right.summary}</p>
                        </div>

                        <div className="mb-6">
                            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-2">
                                <Shield className="w-4 h-4" /> Conventional Agencies
                            </h4>
                            <AgencyList agencies={right.agencies} />
                        </div>

                        <div>
                            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-3 flex items-center gap-2">
                                <Hash className="w-4 h-4" /> Trunked Systems
                            </h4>
                            <SystemList systems={right.trunkedSystems} />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};
