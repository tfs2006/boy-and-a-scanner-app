
import React, { useState, useEffect, useRef } from 'react';
import { TripResult, ServiceType, ScanResult } from '../types';
import { planTrip, filterTripByServices } from '../services/geminiService';
import { generateTripPDF } from '../utils/pdfGenerator';
import { generateCSV } from '../utils/csvGenerator';
import { exportTripSentinelZip } from '../utils/sentinelExporter';
import { isValidLocationInput } from '../utils/security';
import { Map, MapPin, Navigation, FileDown, Loader2, CheckSquare, Square, AlertTriangle, Zap, Bot, Timer, BookOpen, FileText, ArrowLeftRight, History, X, CheckCheck } from 'lucide-react';
import { FrequencyDisplay } from './FrequencyDisplay';
import { ProgrammingManual } from './ProgrammingManual';

const TRIP_HISTORY_KEY = 'trip_history';
const LOAD_STEPS = [
    'Mapping driving route...',
    'Identifying scan zones...',
    'Scanning conventional frequencies...',
    'Cross-referencing trunked systems...',
    'Compiling trip manifest...',
];

function loadTripHistory(): Array<{ start: string; end: string }> {
    try {
        const saved = localStorage.getItem(TRIP_HISTORY_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
}

function saveTripToHistory(start: string, end: string) {
    const history = loadTripHistory();
    const key = `${start}|${end}`.toLowerCase();
    const filtered = history.filter(h => `${h.start}|${h.end}`.toLowerCase() !== key);
    filtered.unshift({ start, end });
    localStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(filtered.slice(0, 5)));
}

export const TripPlanner: React.FC = () => {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(['Police', 'Fire', 'EMS']);
    const [loading, setLoading] = useState(false);
    const [trip, setTrip] = useState<TripResult | null>(null);
    const [masterTrip, setMasterTrip] = useState<TripResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [inputWarning, setInputWarning] = useState<string | null>(null);
    const [searchTime, setSearchTime] = useState<number>(0);
    const [searchStep, setSearchStep] = useState<string>('');
    const [tripHistory, setTripHistory] = useState<Array<{ start: string; end: string }>>([]);
    const [showHistory, setShowHistory] = useState(false);
    const stepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // State for the manual modal in Trip View
    const [selectedManualData, setSelectedManualData] = useState<ScanResult | null>(null);

    // Load trip history on mount
    useEffect(() => {
        setTripHistory(loadTripHistory());
    }, []);

    // Simulate loading step messages while waiting for API
    useEffect(() => {
        if (!loading) {
            setSearchStep('');
            if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
            return;
        }
        let i = 0;
        setSearchStep(LOAD_STEPS[0]);
        stepIntervalRef.current = setInterval(() => {
            i++;
            if (i < LOAD_STEPS.length) setSearchStep(LOAD_STEPS[i]);
        }, 4000);
        return () => { if (stepIntervalRef.current) clearInterval(stepIntervalRef.current); };
    }, [loading]);

    // Re-filter displayed trip when service types change (uses cached master, no API call)
    useEffect(() => {
        if (!masterTrip) return;
        const refiltered = filterTripByServices(masterTrip, serviceTypes);
        setTrip(refiltered);
    }, [serviceTypes, masterTrip]);

    const availableTypes: ServiceType[] = [
        'Police',
        'Fire',
        'EMS',
        'Ham Radio',
        'Railroad',
        'Air',
        'Marine',
        'Federal',
        'Military',
        'Public Works',
        'Utilities',
        'Transportation',
        'Business',
        'Hospitals',
        'Schools',
        'Corrections',
        'Security',
        'Multi-Dispatch'
    ];

    const toggleService = (type: ServiceType) => {
        setServiceTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const handleInputChange = (setter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
        // Real-time validation
        if (!isValidLocationInput(value)) {
            setInputWarning("Invalid characters detected. Please use letters, numbers, spaces, and commas only.");
            // Still allow typing but it will show warning
        } else {
            setInputWarning(null);
        }
        setter(value);
    };

    const handlePlan = async (e: React.FormEvent) => {
        e.preventDefault();

        // Security Check
        if (!isValidLocationInput(start) || !isValidLocationInput(end)) {
            setError("Security Alert: Input contains restricted characters. Remove special symbols.");
            return;
        }

        if (!start || !end) {
            setError("Please enter both start and end locations.");
            return;
        }
        if (serviceTypes.length === 0) {
            setError("Please select at least one service type.");
            return;
        }

        setLoading(true);
        setError(null);
        setInputWarning(null);
        setTrip(null);
        setSearchTime(0);

        const startTime = performance.now();

        try {
            const result = await planTrip(start, end, serviceTypes);
            if (result.trip) {
                // Store master (unfiltered) trip so re-filtering is instant
                const master = result.trip as TripResult;
                setMasterTrip(master);
                setTrip(filterTripByServices(master, serviceTypes));
                saveTripToHistory(start, end);
                setTripHistory(loadTripHistory());
                setShowHistory(false);
            } else {
                setError("Could not generate a route plan. Please try different locations.");
            }
        } catch (err: any) {
            setError(err.message || "Trip planning failed.");
        } finally {
            const endTime = performance.now();
            setSearchTime((endTime - startTime) / 1000);
            setLoading(false);
        }
    };

    const handleSwap = () => {
        setStart(end);
        setEnd(start);
    };

    const selectAllServices = () => setServiceTypes([...availableTypes]);
    const clearAllServices = () => setServiceTypes([]);

    // Helper for Badge
    const getSourceBadge = (isCached: boolean) => {
        if (isCached) {
            return (
                <div className="flex items-center gap-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-purple-900/30 border-purple-500/50 text-purple-400 animate-pulse-subtle">
                        <Zap className="w-3 h-3 fill-purple-400" />
                        <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">Source: Cloud Cache</span>
                    </div>
                    <div className="text-xs font-mono-tech text-emerald-400 flex items-center gap-1">
                        <Timer className="w-3 h-3" />
                        {searchTime.toFixed(2)}s
                    </div>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-amber-900/30 border-amber-500/50 text-amber-400">
                    <Bot className="w-3 h-3" />
                    <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">Source: AI Route Agent</span>
                </div>
                <div className="text-xs font-mono-tech text-slate-500 flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    {searchTime.toFixed(2)}s
                </div>
            </div>
        );
    };

    // Determine if the *whole trip* came from cache by checking the first location
    // Defensive check for trip.locations exists
    const isTripCached = trip?.locations?.[0]?.data?.source === 'Cache';

    // Defensive: Ensure locations is an array
    const locations = trip?.locations || [];

    return (
        <div className="animate-fade-in max-w-5xl mx-auto">
            {/* Input Section */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 mb-8 backdrop-blur-sm">
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2 font-mono-tech">
                    <Map className="w-5 h-5 text-amber-500" />
                    ROUTE CONFIGURATION
                </h2>

                <form onSubmit={handlePlan} className="space-y-6">
                    {/* Recent Trip History */}
                    {tripHistory.length > 0 && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowHistory(h => !h)}
                                className="flex items-center gap-2 text-xs text-slate-400 hover:text-amber-400 transition-colors font-mono-tech uppercase tracking-wider"
                            >
                                <History className="w-3 h-3" />
                                Recent Trips
                            </button>
                            {showHistory && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e293b] border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden">
                                    {tripHistory.map((h, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => { setStart(h.start); setEnd(h.end); setShowHistory(false); }}
                                            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-3 border-b border-slate-800 last:border-0"
                                        >
                                            <Navigation className="w-3 h-3 text-amber-400 shrink-0" />
                                            <span className="font-mono-tech">{h.start} → {h.end}</span>
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => { localStorage.removeItem(TRIP_HISTORY_KEY); setTripHistory([]); setShowHistory(false); }}
                                        className="w-full text-center px-4 py-2 text-xs text-slate-500 hover:text-red-400 transition-colors font-mono-tech uppercase"
                                    >
                                        Clear History
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1">
                            <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">Origin</label>
                            <div className={`flex items-center bg-[#1e293b] rounded border p-1 focus-within:border-amber-500 transition-colors ${inputWarning ? 'border-amber-500/50' : 'border-slate-600'}`}>
                                <MapPin className="ml-2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={start}
                                    onChange={e => handleInputChange(setStart, e.target.value)}
                                    className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 h-9 font-mono-tech"
                                    placeholder="City, State or ZIP"
                                />
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleSwap}
                            title="Swap origin and destination"
                            className="mb-0.5 p-2 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-amber-500 text-slate-400 hover:text-amber-400 transition-all shrink-0"
                        >
                            <ArrowLeftRight className="w-4 h-4" />
                        </button>
                        <div className="flex-1">
                            <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">Destination</label>
                            <div className={`flex items-center bg-[#1e293b] rounded border p-1 focus-within:border-amber-500 transition-colors ${inputWarning ? 'border-amber-500/50' : 'border-slate-600'}`}>
                                <Navigation className="ml-2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={end}
                                    onChange={e => handleInputChange(setEnd, e.target.value)}
                                    className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 h-9 font-mono-tech"
                                    placeholder="City, State or ZIP"
                                />
                            </div>
                        </div>
                    </div>

                    {inputWarning && (
                        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 p-2 rounded border border-amber-900/50">
                            <AlertTriangle className="w-3 h-3" />
                            {inputWarning}
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="block text-xs text-slate-400 font-mono-tech uppercase">Service Filter</label>
                            <div className="flex gap-2">
                                <button type="button" onClick={selectAllServices} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-mono-tech uppercase tracking-wider transition-colors">
                                    <CheckCheck className="w-3 h-3" /> Select All
                                </button>
                                <span className="text-slate-600">|</span>
                                <button type="button" onClick={clearAllServices} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-400 font-mono-tech uppercase tracking-wider transition-colors">
                                    <X className="w-3 h-3" /> Clear All
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {availableTypes.map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleService(type)}
                                    className={`flex items-center justify-center gap-2 px-2 py-2 rounded text-xs font-medium transition-all border ${serviceTypes.includes(type)
                                            ? 'bg-amber-600 text-white border-amber-500 shadow-md'
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                                        }`}
                                >
                                    {serviceTypes.includes(type) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                                    <span className="truncate">{type}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-slate-700 gap-3">
                        {loading && searchStep ? (
                            <div className="flex items-center gap-2 text-sm text-amber-400 font-mono-tech animate-pulse">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {searchStep}
                            </div>
                        ) : (
                            <div />
                        )}
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded px-8 py-3 font-bold font-mono-tech flex items-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
                            {loading ? 'SCANNING ROUTE...' : 'CALCULATE ROUTE & SCAN'}
                        </button>
                    </div>
                </form>

                {error && (
                    <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded text-red-400 text-sm font-mono-tech">
                        ERROR: {error}
                    </div>
                )}
            </div>

            {/* Results */}
            {trip && (
                <div className="space-y-8 animate-fade-in-up">
                    <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-lg flex-wrap gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-white font-mono-tech">TRIP MANIFEST READY</h3>
                            <p className="text-slate-400 text-sm mb-2">
                                {locations.length} Scan Zones Identified from {trip.startLocation} to {trip.endLocation}
                            </p>
                            {getSourceBadge(isTripCached)}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => generateCSV(trip)}
                                className="bg-emerald-900/30 hover:bg-emerald-800/50 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors shadow-lg"
                            >
                                <FileText className="w-4 h-4" />
                                EXPORT CSV
                            </button>
                            <button
                                onClick={() => exportTripSentinelZip(trip)}
                                className="bg-amber-900/30 hover:bg-amber-800/50 border border-amber-500/30 text-amber-400 px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors shadow-lg"
                            >
                                <Zap className="w-4 h-4" />
                                SDS100 EXPORT
                            </button>
                            <button
                                onClick={() => generateTripPDF(trip)}
                                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors shadow-lg shadow-cyan-900/20"
                            >
                                <FileDown className="w-4 h-4" />
                                EXPORT PDF
                            </button>
                        </div>
                    </div>

                    {masterTrip && (
                        <div className="text-xs text-slate-500 font-mono-tech flex items-center gap-2">
                            <CheckCheck className="w-3 h-3 text-emerald-500" />
                            Filters apply instantly from cached data — no reload needed
                        </div>
                    )}

                    <div className="space-y-12">
                        {locations.map((loc, idx) => (
                            <div key={idx} className="relative">
                                <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-slate-800"></div>
                                <div className="absolute -left-4 top-0 w-2.5 h-2.5 rounded-full bg-amber-500"></div>
                                <div className="pl-6">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
                                        <h4 className="text-2xl font-bold text-slate-100 font-mono-tech uppercase flex items-center gap-3">
                                            <span className="text-amber-500">ZONE {idx + 1}:</span> {loc.locationName}
                                        </h4>

                                        <button
                                            onClick={() => setSelectedManualData(loc.data)}
                                            className="self-start sm:self-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 hover:text-white transition-colors text-xs font-mono-tech font-bold uppercase"
                                        >
                                            <BookOpen className="w-3 h-3" />
                                            <span>Manual</span>
                                        </button>
                                    </div>
                                    <FrequencyDisplay data={loc.data} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Bottom export bar — mirrors the top one for long trips */}
                    <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-lg flex-wrap gap-4 mt-4">
                        <p className="text-sm text-slate-400 font-mono-tech">Export complete manifest</p>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                onClick={() => generateCSV(trip!)}
                                className="bg-emerald-900/30 hover:bg-emerald-800/50 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors"
                            >
                                <FileText className="w-4 h-4" /> CSV
                            </button>
                            <button
                                onClick={() => exportTripSentinelZip(trip!)}
                                className="bg-amber-900/30 hover:bg-amber-800/50 border border-amber-500/30 text-amber-400 px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors"
                            >
                                <Zap className="w-4 h-4" /> SDS100
                            </button>
                            <button
                                onClick={() => generateTripPDF(trip!)}
                                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors"
                            >
                                <FileDown className="w-4 h-4" /> PDF
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Render Manual Modal if selected */}
            {selectedManualData && (
                <ProgrammingManual
                    data={selectedManualData}
                    onClose={() => setSelectedManualData(null)}
                />
            )}
        </div>
    );
};
