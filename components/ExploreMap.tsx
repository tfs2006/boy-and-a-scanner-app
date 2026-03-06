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
  updatedAt: string;
}

function normalizeScanResult(raw: unknown): ScanResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const result = raw as Partial<ScanResult>;
  if (!result.locationName || typeof result.locationName !== 'string') return null;

  return {
    source: result.source ?? 'Cache',
    locationName: result.locationName,
    coords: result.coords,
    summary: typeof result.summary === 'string' ? result.summary : '',
    crossRef: result.crossRef,
    agencies: Array.isArray(result.agencies) ? result.agencies : [],
    trunkedSystems: Array.isArray(result.trunkedSystems) ? result.trunkedSystems : [],
    dataQualityWarnings: Array.isArray(result.dataQualityWarnings) ? result.dataQualityWarnings : undefined,
  };
}

function normalizeCoords(raw: unknown): { lat: number; lng: number } | null {
  if (!raw) return null;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (typeof value !== 'object' || value === null) return null;
  const lat = Number((value as { lat?: unknown }).lat);
  const lng = Number((value as { lng?: unknown }).lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
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

const PAGE_SIZE = 250;

export const ExploreMap: React.FC<ExploreMapProps> = ({ isLoggedIn }) => {
  const [locations, setLocations] = useState<CacheLocation[]>([]);
  const [filtered, setFiltered] = useState<CacheLocation[]>([]);
  const [selected, setSelected] = useState<CacheLocation | null>(null);
  const [selectedData, setSelectedData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // ── Fetch all cached locations that have coords ──────────────────────────
  const loadLocations = useCallback(async (append: boolean = false) => {
    if (!supabase) {
      setError('Database not connected.');
      setLoading(false);
      return;
    }

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
      setSelected(null);
      setSelectedData(null);
      setDetailError(null);
    }

    try {
      let parsed: CacheLocation[] = [];
      const offset = append ? locations.length : 0;
      const end = offset + PAGE_SIZE - 1;

      const metadataQuery = await supabase
        .from('search_cache')
        .select('search_key, updated_at, locationName:result_data->>locationName, coords:result_data->coords')
        .order('updated_at', { ascending: false })
        .range(offset, end);

      if (!metadataQuery.error && metadataQuery.data) {
        parsed = (metadataQuery.data as Array<{ search_key: string; updated_at?: string; locationName?: string; coords?: unknown }>)
          .map((row) => {
            try {
              const coords = normalizeCoords(row.coords);
              if (!coords || !row.locationName) return null;
              return {
                key: row.search_key,
                locationName: row.locationName,
                coords,
                updatedAt: row.updated_at,
              } satisfies CacheLocation;
            } catch {
              return null;
            }
          })
          .filter((row): row is CacheLocation => Boolean(row));
      } else {
        const { data, error: err } = await supabase
          .from('search_cache')
          .select('search_key, result_data, updated_at')
          .order('updated_at', { ascending: false })
          .range(offset, end);

        if (err) throw err;

        parsed = [];
        for (const row of data || []) {
          const rd = normalizeScanResult(row.result_data);
          if (rd?.coords?.lat != null && rd?.coords?.lng != null && rd?.locationName) {
            parsed.push({
              key: row.search_key,
              locationName: rd.locationName,
              coords: rd.coords,
              updatedAt: row.updated_at,
            });
          }
        }
      }

      parsed = parsed.filter(({ coords }) => coords.lat >= 17 && coords.lat <= 72 && coords.lng >= -180 && coords.lng <= -60);

      setHasMore(parsed.length === PAGE_SIZE);
      if (append) {
        setLocations(prev => [...prev, ...parsed]);
      } else {
        setLocations(parsed);
        setFiltered(parsed);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load cached locations.');
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [locations.length]);

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

  const handleSelectLocation = useCallback(async (location: CacheLocation) => {
    if (!supabase) return;
    if (selected?.key === location.key) {
      setSelected(null);
      setSelectedData(null);
      setDetailError(null);
      return;
    }

    setSelected(location);
    setSelectedData(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const { data, error: err } = await supabase
        .from('search_cache')
        .select('result_data')
        .eq('search_key', location.key)
        .single();

      if (err) throw err;
      setSelectedData(normalizeScanResult(data?.result_data));
    } catch (e: any) {
      setDetailError(e.message || 'Failed to load cached frequency detail.');
    } finally {
      setDetailLoading(false);
    }
  }, [selected?.key]);

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
    <div className="flex flex-col rounded-xl overflow-hidden border border-slate-700 shadow-2xl animate-fade-in">
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
              Tap or click any signal to browse cached frequencies instantly
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
                  {filtered.length.toLocaleString()} Visible
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
        <div className="flex flex-col items-center justify-center bg-slate-950" style={{ height: 420 }}>
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
        <div className="flex flex-col items-center justify-center bg-slate-950 gap-3" style={{ height: 420 }}>
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
        <div className="flex flex-col items-center justify-center bg-slate-950 gap-3" style={{ height: 420 }}>
          <Globe className="w-10 h-10 text-slate-600" />
          <p className="text-slate-500 font-mono-tech text-sm">
            No cached locations with coordinates yet.
          </p>
          <p className="text-slate-600 font-mono-tech text-xs">
            Search locations on the Local tab to populate the cache.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">

          {/* ── Map (always full width) ── */}
          <div className="relative w-full" style={{ height: selected ? 380 : 520 }}>
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
                    click: () => { void handleSelectLocation(loc); },
                  }}
                />
              ))}
            </MapContainer>

            {/* Overlay: filtered count badge */}
            {search && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] px-3 py-1.5 bg-slate-900/90 backdrop-blur border border-cyan-500/40 rounded-full text-xs font-mono-tech text-cyan-400 pointer-events-none shadow-lg">
                  Showing {filtered.length} of {locations.length} loaded locations
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
                  Tap a dot to view frequencies
                </span>
              </div>
            )}
          </div>

          {/* ── Info Panel (below map, full width) ── */}
          {selected && (
            <div className="border-t border-slate-700 bg-[#0b1221] animate-fade-in-up">

              {/* Panel header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-700 bg-slate-900/80">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
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
              <div className="flex flex-wrap gap-2 px-4 sm:px-6 py-2.5 border-b border-slate-700/50 bg-slate-900/40">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-900/20 border border-purple-500/30 text-purple-400 text-[10px] font-mono-tech font-bold">
                  <Zap className="w-3 h-3 fill-purple-400" />
                  Cloud Cache
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-[10px] font-mono-tech">
                  <Radio className="w-3 h-3" />
                  {selectedData?.agencies.length || 0} Agencies
                </div>
                {(selectedData?.trunkedSystems.length || 0) > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-[10px] font-mono-tech">
                    <Signal className="w-3 h-3" />
                    {selectedData?.trunkedSystems.length} Trunked
                  </div>
                )}
                {selectedData?.coords && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-600 text-slate-500 text-[10px] font-mono-tech">
                    {selectedData.coords.lat.toFixed(3)}, {selectedData.coords.lng.toFixed(3)}
                  </div>
                )}
              </div>

              {/* Summary */}
              {selectedData?.summary && (
                <div className="px-4 sm:px-6 py-3 border-b border-slate-700/50">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {selectedData.summary}
                  </p>
                </div>
              )}

              {/* FrequencyDisplay */}
              <div className="px-3 sm:px-6 py-4">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-10 text-slate-400 font-mono-tech text-sm gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                    Loading cached frequency detail...
                  </div>
                ) : detailError ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <p className="text-sm text-red-400 font-mono-tech">{detailError}</p>
                    <button
                      onClick={() => { void handleSelectLocation(selected); }}
                      className="px-4 py-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 hover:text-white font-mono-tech transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                ) : selectedData ? (
                  <FrequencyDisplay
                    data={selectedData}
                    locationQuery={selected.locationName}
                    isLoggedIn={isLoggedIn}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && locations.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-700 bg-slate-900/70 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 font-mono-tech">
            Loaded {locations.length.toLocaleString()} cached locations{hasMore ? ` in ${PAGE_SIZE}-location pages` : ''}.
          </p>
          {hasMore && (
            <button
              onClick={() => { void loadLocations(true); }}
              disabled={loadingMore}
              className="px-4 py-2 rounded border border-cyan-500/40 bg-cyan-900/20 text-cyan-400 hover:bg-cyan-900/40 hover:text-white transition-colors text-xs font-mono-tech font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Load More Markers
            </button>
          )}
        </div>
      )}
    </div>
  );
};
