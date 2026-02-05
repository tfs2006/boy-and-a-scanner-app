
import React, { useState } from 'react';
import { TripResult, ServiceType, ScanResult } from '../types';
import { planTrip } from '../services/geminiService';
import { generateTripPDF } from '../utils/pdfGenerator';
import { generateCSV } from '../utils/csvGenerator';
import { isValidLocationInput } from '../utils/security';
import { Map, MapPin, Navigation, FileDown, Loader2, CheckSquare, Square, AlertTriangle, Zap, Bot, Timer, BookOpen, FileText } from 'lucide-react';
import { FrequencyDisplay } from './FrequencyDisplay';
import { ProgrammingManual } from './ProgrammingManual';

export const TripPlanner: React.FC = () => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(['Police', 'Fire', 'EMS']);
  const [loading, setLoading] = useState(false);
  const [trip, setTrip] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  const [searchTime, setSearchTime] = useState<number>(0);
  
  // State for the manual modal in Trip View
  const [selectedManualData, setSelectedManualData] = useState<ScanResult | null>(null);

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
            setTrip(result.trip);
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                        <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">Origin</label>
                        <div className={`flex items-center bg-[#1e293b] rounded border p-1 focus-within:border-amber-500 transition-colors ${inputWarning ? 'border-amber-500/50' : 'border-slate-600'}`}>
                            <MapPin className="ml-2 w-4 h-4 text-slate-500" />
                            <input 
                                type="text" 
                                value={start}
                                onChange={e => handleInputChange(setStart, e.target.value)}
                                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 h-9 font-mono-tech"
                                placeholder="City, State"
                            />
                        </div>
                    </div>
                    <div className="relative">
                        <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">Destination</label>
                        <div className={`flex items-center bg-[#1e293b] rounded border p-1 focus-within:border-amber-500 transition-colors ${inputWarning ? 'border-amber-500/50' : 'border-slate-600'}`}>
                            <Navigation className="ml-2 w-4 h-4 text-slate-500" />
                            <input 
                                type="text" 
                                value={end}
                                onChange={e => handleInputChange(setEnd, e.target.value)}
                                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 h-9 font-mono-tech"
                                placeholder="City, State"
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
                    <label className="block text-xs text-slate-400 font-mono-tech mb-3 uppercase">Service Filter</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {availableTypes.map(type => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => toggleService(type)}
                                className={`flex items-center justify-center gap-2 px-2 py-2 rounded text-xs font-medium transition-all border ${
                                    serviceTypes.includes(type) 
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

                <div className="flex justify-end pt-4 border-t border-slate-700">
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded px-8 py-3 font-bold font-mono-tech flex items-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
                        CALCULATE ROUTE & SCAN
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
                    <div className="flex gap-2">
                         <button
                            onClick={() => generateCSV(trip)}
                            className="bg-emerald-900/30 hover:bg-emerald-800/50 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded flex items-center gap-2 font-mono-tech text-sm transition-colors shadow-lg"
                        >
                            <FileText className="w-4 h-4" />
                            EXPORT CSV
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
