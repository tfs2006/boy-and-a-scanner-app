
import React, { useState, useEffect, useRef } from 'react';
import { History, Clock, MapPin } from 'lucide-react';

interface SearchSuggestionsProps {
    onSelect: (query: string) => void;
    visible: boolean;
}

export const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({ onSelect, visible }) => {
    const [history, setHistory] = useState<string[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem('search_history');
        if (saved) {
            try {
                setHistory(JSON.parse(saved).slice(0, 5));
            } catch (e) {
                console.error("Failed to parse search history");
            }
        }
    }, [visible]);

    if (!visible || history.length === 0) return null;

    return (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#1e293b] border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
            <div className="px-3 py-2 text-[10px] font-mono-tech uppercase tracking-wider text-slate-500 border-b border-slate-700/50 flex items-center gap-2">
                <History className="w-3 h-3" /> Recent Searches
            </div>
            <ul>
                {history.map((item, idx) => (
                    <li key={idx}>
                        <button
                            type="button"
                            onClick={() => onSelect(item)}
                            className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-3 group"
                        >
                            <Clock className="w-4 h-4 text-slate-500 group-hover:text-cyan-400" />
                            <span className="font-medium">{item}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export const saveSearchToHistory = (query: string) => {
    if (!query) return;
    const saved = localStorage.getItem('search_history');
    let history: string[] = saved ? JSON.parse(saved) : [];
    // Remove if exists to push to top
    history = history.filter(h => h.toLowerCase() !== query.toLowerCase());
    // Add to front
    history.unshift(query);
    // Limit to 10
    localStorage.setItem('search_history', JSON.stringify(history.slice(0, 10)));
};
