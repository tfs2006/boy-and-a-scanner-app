import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../services/supabaseClient';
import { ScanResult } from '../types';
import { FrequencyDisplay } from './FrequencyDisplay';
import {
  Globe, Loader2, X, MapPin, Zap, RefreshCw,
  Radio, Signal, Search, Database, AlertCircle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheLocation {
  key: string;
  locationName: string;
  coords: { lat: number; lng: number };
  data: ScanResult;
  updatedAt?: string;
}

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

const createMarkerIcon = (isSelected: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="explore-pin${isSelected ? ' explore-pin--selected' : ''}">
      <div class="explore-pin__ring"></div>
      <div class="explore-pin__dot"></div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

// Resize map when the side panel opens/closes
const MapResizer: React.FC<{ trigger: boolean }> = ({ trigger }) => {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 310);
    return () => clearTimeout(t);
  }, [trigger, map]);
  return null;
};

// Fit to continental US on first load
const FitUS: React.FC = () => {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.fitBounds(
      [[24.396308, -125.0], [49.384358, -66.93457]],
      { padding: [40, 40], maxZoom: 6 }
    );
  }, [map]);
  return null;
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface ExploreMapProps {
  isLoggedIn: boolean;
}

export const ExploreMap: React.FC<ExploreMapProps> = ({ isLoggedIn }) => {
  const [locations, setLocations] = useState<CacheLocation[]>([]);
  const [filtered, setFiltered] = useState<CacheLocation[]>([]);
  const [selected, setSelected] = useState<CacheLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // ── Fetch all cached locations that have coords ──────────────────────────
  const loadLocations = useCallback(async () => {
    if (!supabase) {
      setError('Database not connected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(null);

    try {
      // Fetch all rows — we filter client-side for those that have coords
      const { data, error: err } = await supabase
        .from('search_cache')
        .select('search_key, result_data, updated_at')
        .order('updated_at', { ascending: false });

      if (err) throw err;

      const parsed: CacheLocation[] = [];
      for (const row of data || []) {
        const rd = row.result_data as ScanResult;
        if (
          rd?.coords?.lat != null &&
          rd?.coords?.lng != null &&
          rd?.locationName
        ) {
          // Skip non-US coords (basic guard)
          const { lat, lng } = rd.coords;
          if (lat < 17 || lat > 72 || lng < -180 || lng > -60) continue;

          parsed.push({
            key: row.search_key,
            locationName: rd.locationName,
            coords: rd.coords,
            data: rd,
            updatedAt: row.updated_at,
          });
        }
      }

      setLocations(parsed);
      setFiltered(parsed);
    } catch (e: any) {
      setError(e.message || 'Failed to load cached locations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  // ── Search filter ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!search.trim()) {
      setFiltered(locations);
    } else {
      const q = search.toLowerCase();
      setFiltered(locations.filter(l => l.locationName.toLowerCase().includes(q)));
    }
  }, [search, locations]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalAgencies = locations.reduce((a, l) => a + (l.data.agencies?.length || 0), 0);

  // ── Relative date helper ──────────────────────────────────────────────────
  const relDate = (iso?: string) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden border border-slate-700 shadow-2xl animate-fade-in"
      style={{ height: 'calc(100vh - 140px)', minHeight: 500 }}
    >
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-700 rounded-lg shadow-lg shadow-cyan-900/20">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white font-mono-tech tracking-tight">
              CACHE EXPLORER
            </h2>
            <p className="text-[10px] text-slate-400 font-mono-tech uppercase tracking-wider">
              Click any signal to browse cached frequencies instantly
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Stats pills */}
          {!loading && locations.length > 0 && (
            <>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-900/20 border border-cyan-500/30 rounded-full">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-mono-tech text-cyan-400 font-bold">
                  {locations.length} Locations
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 border border-slate-700 rounded-full">
                <Database className="w-3 h-3 text-purple-400" />
                <span className="text-xs font-mono-tech text-slate-300">
                  {totalAgencies.toLocaleString()} Agencies
                </span>
              </div>
            </>
          )}

          {/* Search filter */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter locations…"
              className="pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 font-mono-tech focus:outline-none focus:border-cyan-500 w-44 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={loadLocations}
            disabled={loading}
            title="Refresh"
            className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-950">
          <div className="relative mb-6">
            <div className="w-16 h-16 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Globe className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
          </div>
          <p className="text-cyan-400 font-mono-tech text-sm animate-pulse">
            Loading cached signal map…
          </p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 gap-3">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-red-400 font-mono-tech text-sm">{error}</p>
          <button
            onClick={loadLocations}
            className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 hover:text-white font-mono-tech transition-colors"
          >
            Retry
          </button>
        </div>
      ) : locations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 gap-3">
          <Globe className="w-10 h-10 text-slate-600" />
          <p className="text-slate-500 font-mono-tech text-sm">
            No cached locations with coordinates yet.
          </p>
          <p className="text-slate-600 font-mono-tech text-xs">
            Search locations on the Local tab to populate the cache.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">

          {/* ── Map Column ── */}
          <div
            className="relative shrink-0 transition-all duration-300"
            style={{ width: selected ? '55%' : '100%' }}
          >
            <MapContainer
              center={[39.5, -98.35]}
              zoom={4}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom
              zoomControl
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              <FitUS />
              <MapResizer trigger={!!selected} />

              {filtered.map(loc => (
                <Marker
                  key={loc.key}
                  position={[loc.coords.lat, loc.coords.lng]}
                  icon={createMarkerIcon(selected?.key === loc.key)}
                  eventHandlers={{
                    click: () => setSelected(loc),
                  }}
                />
              ))}
            </MapContainer>

            {/* Overlay: filtered count badge */}
            {search && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] px-3 py-1.5 bg-slate-900/90 backdrop-blur border border-cyan-500/40 rounded-full text-xs font-mono-tech text-cyan-400 pointer-events-none shadow-lg">
                Showing {filtered.length} of {locations.length} locations
              </div>
            )}

            {/* Legend */}
            <div className="absolute bottom-3 left-3 z-[400] flex items-center gap-3 px-3 py-2 bg-slate-900/85 backdrop-blur border border-slate-700 rounded-lg pointer-events-none shadow-lg">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#06b6d4]" />
                <span className="text-[10px] font-mono-tech text-slate-400">Cached</span>
              </div>
              <div className="w-px h-3 bg-slate-700" />
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
                <span className="text-[10px] font-mono-tech text-slate-400">Selected</span>
              </div>
            </div>

            {/* Hint when nothing selected */}
            {!selected && (
              <div className="absolute bottom-3 right-3 z-[400] flex items-center gap-2 px-3 py-2 bg-slate-900/85 backdrop-blur border border-slate-700 rounded-lg pointer-events-none shadow-lg">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-mono-tech text-slate-400">
                  Click a dot to view frequencies
                </span>
              </div>
            )}
          </div>

          {/* ── Side Panel ── */}
          {selected && (
            <div
              className="flex flex-col bg-[#0f172a] border-l border-slate-700 overflow-hidden shrink-0 animate-slide-in-right"
              style={{ width: '45%' }}
            >
              {/* Panel header */}
              <div className="flex items-start justify-between px-4 py-3 border-b border-slate-700 bg-slate-900/80 shrink-0">
                <div className="flex items-start gap-2 min-w-0 pr-2">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white font-mono-tech leading-tight">
                      {selected.locationName}
                    </p>
                    {selected.updatedAt && (
                      <p className="text-[10px] text-slate-500 font-mono-tech mt-0.5">
                        Cached {relDate(selected.updatedAt)}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                  title="Close panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Meta chips */}
              <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-slate-700/50 bg-slate-900/40 shrink-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-900/20 border border-purple-500/30 text-purple-400 text-[10px] font-mono-tech font-bold">
                  <Zap className="w-3 h-3 fill-purple-400" />
                  Cloud Cache
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-[10px] font-mono-tech">
                  <Radio className="w-3 h-3" />
                  {selected.data.agencies?.length || 0} Agencies
                </div>
                {(selected.data.trunkedSystems?.length || 0) > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-[10px] font-mono-tech">
                    <Signal className="w-3 h-3" />
                    {selected.data.trunkedSystems.length} Trunked
                  </div>
                )}
                {selected.data.coords && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-500 text-[10px] font-mono-tech">
                    {selected.data.coords.lat.toFixed(3)}, {selected.data.coords.lng.toFixed(3)}
                  </div>
                )}
              </div>

              {/* Summary */}
              {selected.data.summary && (
                <div className="px-4 py-3 border-b border-slate-700/50 shrink-0">
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                    {selected.data.summary}
                  </p>
                </div>
              )}

              {/* FrequencyDisplay — scrollable */}
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <FrequencyDisplay
                  data={selected.data}
                  locationQuery={selected.locationName}
                  isLoggedIn={isLoggedIn}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
