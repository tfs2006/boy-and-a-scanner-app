import React, { useState, useEffect } from 'react';
import { Search, MapPin, Loader2, Navigation, ChevronDown, Filter, X } from 'lucide-react';

interface SearchFormProps {
    onSearch: (query: string) => void;
    loading: boolean;
    initialQuery?: string;
    onGeoLocation?: () => void;
    onCancel?: () => void;
    onInputFocus?: () => void;
    onInputBlur?: () => void;
}

const US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

export function SearchForm({ onSearch, loading, initialQuery = '', onGeoLocation, onCancel, onInputFocus, onInputBlur }: SearchFormProps) {
    const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
    const [simpleQuery, setSimpleQuery] = useState(initialQuery);

    // Advanced Fields
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [county, setCounty] = useState('');
    const [zip, setZip] = useState('');

    // Update simple query if initial changes (e.g. via GPS)
    useEffect(() => {
        if (initialQuery) setSimpleQuery(initialQuery);
    }, [initialQuery]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;

        if (mode === 'simple') {
            if (simpleQuery.trim()) onSearch(simpleQuery);
        } else {
            // Build structured query
            // Priority: Zip > County/State > City/State > State Only
            let query = '';
            if (zip.trim()) {
                query = zip.trim();
            } else if (county.trim() && state) {
                query = `${county.trim()} County, ${state}`;
            } else if (city.trim() && state) {
                query = `${city.trim()}, ${state}`;
            } else if (county.trim()) { // County without state? Risk of ambiguity
                query = `${county.trim()} County`;
            } else if (state) {
                query = state; // Likely too broad, but valid
            } else {
                query = city.trim();
            }

            if (query.trim()) onSearch(query);
        }
    };

    const clearAdvanced = () => {
        setCity('');
        setState('');
        setCounty('');
        setZip('');
    };

    return (
        <div className="w-full max-w-xl mx-auto mb-8 transition-all duration-300">

            {/* Mode Switcher */}
            <div className="flex justify-end mb-2">
                <button
                    type="button"
                    onClick={() => setMode(mode === 'simple' ? 'advanced' : 'simple')}
                    className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition-colors font-mono-tech uppercase tracking-wider bg-slate-800/50 px-2 py-1 rounded border border-slate-700 hover:border-cyan-500/50"
                >
                    {mode === 'simple' ? (
                        <>
                            <Filter className="w-3 h-3" /> Advanced Search
                        </>
                    ) : (
                        <>
                            <X className="w-3 h-3" /> Simple Search
                        </>
                    )}
                </button>
            </div>

            <form onSubmit={handleSubmit} className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur opacity-30 group-hover:opacity-60 transition duration-200"></div>
                <div className="relative bg-[#1e293b] rounded-xl border border-slate-700 p-1 shadow-2xl">

                    {mode === 'simple' ? (
                        <div className="flex items-center">
                            <MapPin className="ml-3 w-5 h-5 text-slate-500 hidden sm:block" />
                            <input
                                type="text"
                                value={simpleQuery}
                                onChange={(e) => setSimpleQuery(e.target.value)}
                                placeholder="Enter ZIP, City, or use GPS"
                                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 h-12 pl-3 font-mono-tech text-lg outline-none"
                                disabled={loading}
                                onFocus={onInputFocus}
                                onBlur={onInputBlur}
                            />
                            <div className="flex items-center gap-1 pr-1">
                                {onGeoLocation && (
                                    <button
                                        type="button"
                                        onClick={onGeoLocation}
                                        disabled={loading}
                                        title="Use GPS Location"
                                        className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors"
                                    >
                                        <Navigation className="w-5 h-5" />
                                    </button>
                                )}
                                {loading && onCancel ? (
                                    <button
                                        type="button"
                                        onClick={onCancel}
                                        className="bg-red-900/80 hover:bg-red-800 text-white rounded-lg px-6 h-10 font-bold transition-all flex items-center gap-2 font-mono-tech tracking-wide ml-1 border border-red-500/30"
                                    >
                                        <X className="w-4 h-4" />
                                        <span className="hidden sm:inline">CANCEL</span>
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg px-6 h-10 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-mono-tech tracking-wide ml-1"
                                    >
                                        {loading ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <>
                                                <span className="hidden sm:inline">SCAN</span> <Search className="w-4 h-4" />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                {/* State */}
                                <div>
                                    <label className="text-[10px] uppercase text-cyan-400 font-mono-tech font-bold block mb-1 tracking-wider">State</label>
                                    <div className="relative">
                                        <select
                                            value={state}
                                            onChange={(e) => setState(e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono-tech text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none appearance-none cursor-pointer hover:bg-slate-800 transition-colors"
                                        >
                                            <option value="">Select State</option>
                                            {US_STATES.map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                                    </div>
                                </div>

                                {/* Zip */}
                                <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-mono-tech font-bold block mb-1 tracking-wider">Zip Code</label>
                                    <input
                                        type="text"
                                        value={zip}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                                            setZip(val);
                                        }}
                                        placeholder="5-Digit ZIP"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono-tech text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder-slate-600"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* City */}
                                <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-mono-tech font-bold block mb-1 tracking-wider">City</label>
                                    <input
                                        type="text"
                                        value={city}
                                        onChange={(e) => setCity(e.target.value)}
                                        placeholder="e.g. Springfield"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono-tech text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder-slate-600"
                                    />
                                </div>

                                {/* County */}
                                <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-mono-tech font-bold block mb-1 tracking-wider">County</label>
                                    <input
                                        type="text"
                                        value={county}
                                        onChange={(e) => setCounty(e.target.value)}
                                        placeholder="e.g. Cook"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono-tech text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder-slate-600"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex justify-between items-center border-t border-slate-800 mt-2">
                                <button type="button" onClick={clearAdvanced} className="text-xs text-slate-500 hover:text-red-400 font-mono-tech transition-colors uppercase tracking-wider font-bold px-2 py-1 rounded hover:bg-slate-800">
                                    Clear Fields
                                </button>
                                {loading && onCancel ? (
                                    <button
                                        type="button"
                                        onClick={onCancel}
                                        className="bg-red-900/80 hover:bg-red-800 text-white rounded-lg px-6 py-2 font-bold transition-all flex items-center gap-2 font-mono-tech tracking-wide shadow-lg shadow-red-900/20 border border-red-500/30"
                                    >
                                        <X className="w-4 h-4" />
                                        CANCEL SEARCH
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={loading || (!zip && !state && !city && !county)}
                                        className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg px-6 py-2 font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-mono-tech tracking-wide shadow-lg shadow-cyan-900/20"
                                    >
                                        {loading ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <>
                                                SEARCH DATABASE <Search className="w-4 h-4 ml-1" />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </form>
        </div>
    );
}
