
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Search, Radio, Loader2, MapPin, ExternalLink, SignalHigh, Database, Bot, Map, LocateFixed, ShieldCheck, Zap, AlertCircle, CheckCircle2, Timer, LogOut, User, Navigation, CheckSquare, Square, ChevronDown, ChevronUp, Filter, BookOpen, Coffee, Globe, ShoppingBag, MessageSquarePlus, FileDown, Settings, Eye, EyeOff, Star, X, Copy, Sun, Moon, Trophy, PlusCircle, Ear, List, Bell, Printer, Menu, Users } from 'lucide-react';
import { searchFrequencies, getDatabaseStats } from './services/geminiService';
import { RRCredentials } from './services/rrApi';
import { SearchResponse, ScanResult, ServiceType } from './types';
import { FrequencyDisplay } from './components/FrequencyDisplay';
import { Auth } from './components/Auth';
import { isValidLocationInput } from './utils/security';
import { supabase } from './services/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { generateSentinelExport } from './utils/exportUtils';
import { getFavorites, addFavorite, removeFavorite, Favorite } from './services/favoritesService';
import { loadServicePreferences, saveServicePreferences, getLocalServicePreferences } from './services/preferencesService';
import { getNotifications, getUnreadCount, markAllRead, AppNotification } from './services/notificationsService';
import { SearchSuggestions, saveSearchToHistory } from './components/SearchSuggestions';
import { SearchForm } from './components/SearchForm';
import {
  CONVENTIONAL_SYSTEM_FILTER_KEYS as SDS100_CONVENTIONAL_KEYS,
  TRUNKED_SYSTEM_FILTER_KEYS as SDS100_TRUNKED_KEYS,
  detectSystemFilters,
  frequencyMatchesSystemFilter,
  trunkedSystemMatchesFilter,
  type SystemFilterKey,
} from './utils/systemTypeFilters';

const TripPlanner = lazy(async () => ({ default: (await import('./components/TripPlanner')).TripPlanner }));
const ProgrammingManual = lazy(async () => ({ default: (await import('./components/ProgrammingManual')).ProgrammingManual }));
const MapDisplay = lazy(async () => ({ default: (await import('./components/MapDisplay')).MapDisplay }));
const ComparisonView = lazy(async () => ({ default: (await import('./components/ComparisonView')).ComparisonView }));
const Leaderboard = lazy(async () => ({ default: (await import('./components/Leaderboard')).Leaderboard }));
const ContributeModal = lazy(async () => ({ default: (await import('./components/ContributeModal')).ContributeModal }));
const ExploreMap = lazy(async () => ({ default: (await import('./components/ExploreMap')).ExploreMap }));
const ProfileModal = lazy(async () => ({ default: (await import('./components/ProfileModal')).ProfileModal }));
const CommunityHub = lazy(async () => ({ default: (await import('./components/CommunityHub')).CommunityHub }));

const SDS100_FILTER_OPTIONS: Array<{ key: SystemFilterKey; label: string; sublabel: string }> = [
  { key: 'analog', label: 'Analog', sublabel: 'FM / AM' },
  { key: 'p25-conv', label: 'P25 Conventional', sublabel: 'Conventional' },
  { key: 'p25-phase1', label: 'P25 Phase I', sublabel: 'Trunked' },
  { key: 'p25-phase2', label: 'P25 Phase II', sublabel: 'Trunked' },
  { key: 'dmr-conv', label: 'DMR Conventional', sublabel: 'Conventional' },
  { key: 'dmr-trunked', label: 'DMR Trunked', sublabel: 'Trunked' },
  { key: 'nxdn-conv', label: 'NXDN Conventional', sublabel: 'Conventional' },
  { key: 'nxdn-trunked', label: 'NXDN Trunked', sublabel: 'Trunked' },
  { key: 'edacs', label: 'EDACS', sublabel: 'Trunked' },
  { key: 'ltr', label: 'LTR', sublabel: 'Trunked' },
  { key: 'motorola', label: 'Motorola', sublabel: 'Type I/II' }
];

const SDS100_PRESETS: Array<{ label: string; keys: SystemFilterKey[] }> = [
  { label: 'Conventional Only', keys: SDS100_CONVENTIONAL_KEYS },
  { label: 'Trunked Only', keys: SDS100_TRUNKED_KEYS },
  { label: 'Public Safety Mix', keys: ['analog', 'p25-conv', 'p25-phase1', 'p25-phase2', 'dmr-conv', 'dmr-trunked', 'nxdn-conv', 'nxdn-trunked'] },
];

const SectionLoader = ({ label = 'Loading module...' }: { label?: string }) => (
  <div className="flex items-center justify-center py-16 text-slate-400 font-mono-tech text-sm gap-3">
    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
    {label}
  </div>
);

type StatusNotice = {
  tone: 'success' | 'error' | 'warning' | 'info';
  message: string;
  detail?: string;
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const sessionUserId = session?.user.id ?? null;

  const [mode, setMode] = useState<'scan' | 'trip' | 'leaderboard' | 'explore' | 'community'>('scan');

  // Crowdsource / Contribute Modal
  const [showContribute, setShowContribute] = useState(false);

  // Scan State
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchStep, setSearchStep] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [grounding, setGrounding] = useState<SearchResponse['groundingChunks']>(null);
  const [error, setError] = useState<string | null>(null);
  const [rrWarning, setRrWarning] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [isSaved, setIsSaved] = useState(false);

  // Service Filters — initial value from localStorage, refreshed from Supabase when session loads
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(getLocalServicePreferences);
  const [showFilters, setShowFilters] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showSds100Modal, setShowSds100Modal] = useState(false);
  const [sds100Filters, setSds100Filters] = useState<Set<SystemFilterKey>>(new Set());

  const sds100ExportSummary = React.useMemo(() => {
    if (!result) {
      return {
        agencies: 0,
        channels: 0,
        trunkedSystems: 0,
        talkgroups: 0,
      };
    }

    const selected = sds100Filters;

    const matchedAgencies = (result.agencies || [])
      .map((agency) => ({
        ...agency,
        frequencies: (agency.frequencies || []).filter((freq) =>
          SDS100_CONVENTIONAL_KEYS.some((key) => selected.has(key) && frequencyMatchesSystemFilter(freq, key))
        ),
      }))
      .filter((agency) => agency.frequencies.length > 0);

    const matchedSystems = (result.trunkedSystems || []).filter((system) =>
      SDS100_TRUNKED_KEYS.some((key) => selected.has(key) && trunkedSystemMatchesFilter(system, key))
    );

    return {
      agencies: matchedAgencies.length,
      channels: matchedAgencies.reduce((sum, agency) => sum + agency.frequencies.length, 0),
      trunkedSystems: matchedSystems.length,
      talkgroups: matchedSystems.reduce((sum, system) => sum + (system.talkgroups?.length || 0), 0),
    };
  }, [result, sds100Filters]);

  const sds100AvailableFilters = React.useMemo(() => {
    return result ? detectSystemFilters(result) : new Set<SystemFilterKey>();
  }, [result]);


  // Comparison State
  const [pinnedResult, setPinnedResult] = useState<ScanResult | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const activeSearchControllerRef = useRef<AbortController | null>(null);
  const activeSearchRequestIdRef = useRef(0);

  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!statusNotice) return;
    const timeoutId = window.setTimeout(() => setStatusNotice(null), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [statusNotice]);

  // URL param: auto-search when arriving from SEO frequency pages (?q=ZIP)
  const pendingUrlQuery = useRef<string | null>(
    new URLSearchParams(window.location.search).get('q')
  );
  useEffect(() => {
    if (pendingUrlQuery.current) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    if (session && !authLoading && pendingUrlQuery.current) {
      const q = pendingUrlQuery.current;
      pendingUrlQuery.current = null;
      handleFavoriteClick(q);
    }
  }, [session, authLoading]);

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

  // Stats
  const [dbCount, setDbCount] = useState<number>(0);
  const [searchTime, setSearchTime] = useState<number>(0);

  // Cache Status State
  const [cacheStatus, setCacheStatus] = useState<'checking' | 'connected' | 'error' | 'offline'>('checking');
  const [cacheErrorMsg, setCacheErrorMsg] = useState<string>('');

  // RadioReference Direct API Credentials
  const [showRRSettings, setShowRRSettings] = useState(false);
  const [rrUsername, setRrUsername] = useState(() => sessionStorage.getItem('rr_username') || localStorage.getItem('rr_username') || '');
  const [rrPassword, setRrPassword] = useState(() => sessionStorage.getItem('rr_password') || localStorage.getItem('rr_password') || '');
  const [showRRPassword, setShowRRPassword] = useState(false);
  const rrCredentials: RRCredentials | undefined = (rrUsername && rrPassword) ? { username: rrUsername, password: rrPassword } : undefined;

  useEffect(() => {
    const legacyUsername = localStorage.getItem('rr_username');
    const legacyPassword = localStorage.getItem('rr_password');
    if (legacyUsername) {
      sessionStorage.setItem('rr_username', legacyUsername);
      localStorage.removeItem('rr_username');
    }
    if (legacyPassword) {
      sessionStorage.setItem('rr_password', legacyPassword);
      localStorage.removeItem('rr_password');
    }
  }, []);

  const saveRRCredentials = () => {
    sessionStorage.setItem('rr_username', rrUsername);
    sessionStorage.setItem('rr_password', rrPassword);
    localStorage.removeItem('rr_username');
    localStorage.removeItem('rr_password');
    setShowRRSettings(false);
  };

  const clearRRCredentials = () => {
    setRrUsername('');
    setRrPassword('');
    sessionStorage.removeItem('rr_username');
    sessionStorage.removeItem('rr_password');
    localStorage.removeItem('rr_username');
    localStorage.removeItem('rr_password');
  };

  // Handle Authentication Session
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setSession(session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setSession(session);
      setAuthLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Handle Connection Check (Only if logged in)
  useEffect(() => {
    if (!sessionUserId) {
      setFavorites([]);
      setNotifications([]);
      setUnreadCount(0);
      setShowNotifPanel(false);
      return;
    }

    let cancelled = false;

    const bootstrapUserState = async () => {
      checkConnection();
      const [favs, prefs, unread] = await Promise.all([
        getFavorites(),
        loadServicePreferences(sessionUserId),
        getUnreadCount(sessionUserId),
      ]);

      if (cancelled) return;
      setFavorites(favs);
      setServiceTypes(prefs);
      setUnreadCount(unread);
    };

    void bootstrapUserState();

    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

  // Poll unread notification count every 60 seconds when logged in
  useEffect(() => {
    if (!sessionUserId) return;
    const interval = setInterval(() => {
      getUnreadCount(sessionUserId).then(setUnreadCount);
    }, 60_000);
    return () => clearInterval(interval);
  }, [sessionUserId]);

  const handleOpenNotifPanel = async () => {
    const nextOpen = !showNotifPanel;
    setShowNotifPanel(nextOpen);
    if (nextOpen && sessionUserId) {
      // Fetch fresh notifications and mark all read
      const notifs = await getNotifications(sessionUserId);
      setNotifications(notifs);
      await markAllRead(sessionUserId);
      setUnreadCount(0);
    }
  };

  // Check if current query is already favorited
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSaved(favorites.some(f => f.location_query.toLowerCase() === searchQuery.trim().toLowerCase()));
    } else {
      setIsSaved(false);
    }
  }, [searchQuery, favorites]);

  const toggleFavorite = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    const existing = favorites.find(f => f.location_query.toLowerCase() === query.toLowerCase());
    if (existing) {
      await removeFavorite(existing.id);
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
    } else {
      const newFav = await addFavorite(query);
      if (newFav) setFavorites(prev => [newFav, ...prev]);
    }
  };

  const handleFavoriteClick = (query: string) => {
    setSearchQuery(query);
    setResult(null);
    setError(null);
    setShowSuggestions(false);
    // Directly trigger search without fragile DOM manipulation
    if (!isValidLocationInput(query)) return;
    if (serviceTypes.length === 0) return;
    runSearch(query);
  };

  const beginSearchRequest = () => {
    activeSearchControllerRef.current?.abort();
    const controller = new AbortController();
    activeSearchControllerRef.current = controller;
    activeSearchRequestIdRef.current += 1;
    return { controller, requestId: activeSearchRequestIdRef.current };
  };

  const isActiveSearch = (requestId: number, signal?: AbortSignal) => {
    return !signal?.aborted && activeSearchRequestIdRef.current === requestId;
  };

  const finishSearch = (requestId: number, startTime: number, signal?: AbortSignal) => {
    if (!isActiveSearch(requestId, signal)) return;
    const endTime = performance.now();
    setSearchTime((endTime - startTime) / 1000);
    setLoading(false);
    setSearchStep('');
  };

  const runSearch = (query: string) => {
    const { controller, requestId } = beginSearchRequest();
    setLoading(true);
    setError(null);
    setResult(null);
    setGrounding(null);
    setSearchTime(0);
    setSearchStep('Initializing Scanner Protocol...');
    const startTime = performance.now();

    performAiSearch(query, controller.signal, requestId).catch(err => {
      if (err?.name === 'AbortError' || !isActiveSearch(requestId, controller.signal)) return;
      setError("Search failed. " + (err.message || 'Please try again.'));
    }).finally(() => {
      finishSearch(requestId, startTime, controller.signal);
    });
  };

  const removeFavoriteById = async (id: string) => {
    await removeFavorite(id);
    setFavorites(prev => prev.filter(f => f.id !== id));
  };

  const checkConnection = async () => {
    if (!supabase) {
      setCacheStatus('offline');
      return;
    }

    try {
      // 1. Connection Test
      const { error } = await supabase.from('search_cache').select('search_key').limit(1);

      if (error) {
        console.error("Supabase Connection Error:", error);
        setCacheStatus('error');
        setCacheErrorMsg(error.message);
      } else {
        setCacheStatus('connected');
        // 2. Fetch Stats
        updateStats();
      }
    } catch (e) {
      setCacheStatus('error');
    }
  };

  const updateStats = async () => {
    const count = await getDatabaseStats();
    setDbCount(count);
  };

  const handleSignOut = async () => {
    clearRRCredentials();
    activeSearchControllerRef.current?.abort();
    activeSearchRequestIdRef.current += 1;
    setResult(null);
    setPinnedResult(null);
    setSearchQuery('');
    setGrounding(null);
    setError(null);
    setRrWarning(null);
    setLoading(false);
    setSearchStep('');

    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  const toggleService = (type: ServiceType) => {
    setServiceTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleSaveDefaults = async () => {
    await saveServicePreferences(serviceTypes, session?.user.id);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 2500);
  };

  // Workflow steps for the loading animation
  useEffect(() => {
    if (loading && !result) {
      const steps = [
        'Engaging AI Analysis...',
        'Cross-Referencing Data Sources...',
        'Verifying Frequency Integrity...',
        'Compiling Accuracy Report...'
      ];
      let i = 0;

      const interval = setInterval(() => {
        if (i < steps.length) {
          setSearchStep(steps[i]);
          i++;
        }
      }, 2000); // Update text every 2s to show progress
      return () => clearInterval(interval);
    }
  }, [loading, result]);

  const handleGeoLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    const { controller, requestId } = beginSearchRequest();

    setLoading(true);
    setError(null);
    setResult(null);
    setGrounding(null);
    setSearchTime(0);
    setSearchStep('Acquiring GPS Satellite Lock...');

    const startTime = performance.now();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!isActiveSearch(requestId, controller.signal)) return;
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          setError('GPS Error: Received invalid coordinates from the device.');
          finishSearch(requestId, startTime, controller.signal);
          return;
        }
        const coordString = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        setSearchQuery(coordString);
        try {
          await performAiSearch(coordString, controller.signal, requestId);
        } catch (err: any) {
          if (err?.name === 'AbortError' || !isActiveSearch(requestId, controller.signal)) return;
          setError("Search failed. " + (err.message || 'Please try again.'));
        } finally {
          finishSearch(requestId, startTime, controller.signal);
        }
      },
      (err) => {
        if (!isActiveSearch(requestId, controller.signal)) return;
        setLoading(false);
        setSearchStep('');
        if (err.code === err.PERMISSION_DENIED) {
          setError("GPS Access Denied. Please manually enter your location.");
        } else if (err.code === err.TIMEOUT) {
          setError("GPS Timeout. Please try again or enter location manually.");
        } else {
          setError("GPS Error: " + err.message);
        }
        console.error(err);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleCancel = () => {
    activeSearchControllerRef.current?.abort();
    activeSearchRequestIdRef.current += 1;
    setLoading(false);
    setSearchStep('');
    setError(null);
  };

  const pushStatusNotice = (notice: StatusNotice) => {
    setStatusNotice(notice);
  };

  const handleSentinelCopy = async (data: ScanResult) => {
    const text = generateSentinelExport(data);
    if (!text) {
      pushStatusNotice({ tone: 'warning', message: 'No conventional frequencies to export.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pushStatusNotice({
        tone: 'success',
        message: 'Sentinel data copied to the clipboard.',
        detail: "Open Uniden Sentinel, right-click a Department, then choose Paste.",
      });
    } catch (err) {
      console.error("Clipboard failed:", err);
      pushStatusNotice({ tone: 'error', message: 'Failed to copy Sentinel data to the clipboard.' });
    }
  };

  const handleCsvExport = async (data: ScanResult) => {
    const { generateCSV } = await import('./utils/csvGenerator');
    generateCSV(data);
  };

  const handleChirpExport = async (data: ScanResult) => {
    const { exportChirpCSV } = await import('./utils/chirpExporter');
    const result = exportChirpCSV(data);
    if (result.ok) {
      pushStatusNotice({
        tone: 'success',
        message: `CHIRP export ready: ${result.count} channels.`,
        detail: `Downloaded ${result.filename}.`,
      });
      return;
    }

    pushStatusNotice({ tone: 'warning', message: result.message });
  };

  const openSds100Modal = (data: ScanResult) => {
    const available = detectSystemFilters(data);
    setSds100Filters(available);
    setShowSds100Modal(true);
  };

  const toggleSds100Filter = (key: SystemFilterKey) => {
    setSds100Filters(prev => {
      if (!sds100AvailableFilters.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSds100Export = async (data: ScanResult) => {
    try {
      const { exportSentinelZip } = await import('./utils/sentinelExporter');
      await exportSentinelZip(data, Array.from(sds100Filters));
      setShowSds100Modal(false);
      pushStatusNotice({
        tone: 'success',
        message: 'SDS100 package generated.',
        detail: 'Check your downloads for the Sentinel ZIP package.',
      });
    } catch (err) {
      console.error('SDS100 export failed:', err);
      pushStatusNotice({ tone: 'error', message: 'Failed to generate the SDS100 package. Please try again.' });
    }
  };

  const applySds100Preset = (keys: SystemFilterKey[]) => {
    const allowed = keys.filter((key) => sds100AvailableFilters.has(key));
    setSds100Filters(new Set(allowed));
  };

  // handleSearch removed - logic moved to SearchForm onSearch prop


  const performAiSearch = async (query: string, signal?: AbortSignal, requestId?: number) => {
    setError(null);
    setRrWarning(null);
    const isZip = /^\d{5}$/.test(query.trim());
    if (isZip && rrCredentials) {
      setSearchStep('Connecting to RadioReference Database...');
    } else {
      setSearchStep(`Analyzing Location & Scanning for: ${serviceTypes.slice(0, 3).join(', ')}...`);
    }
    try {
      const response = await searchFrequencies(query, serviceTypes, rrCredentials, signal);
      if ((requestId !== undefined && !isActiveSearch(requestId, signal)) || signal?.aborted) {
        return;
      }
      if (response.rrError) {
        // RR failed but we may still have AI data — show a targeted warning
        const msg = response.rrError;
        if (/auth|password|credentials|access denied/i.test(msg)) {
          setRrWarning('RadioReference authentication failed — check your username and password in Settings.');
        } else if (/zip.*not found|not found.*zip/i.test(msg)) {
          setRrWarning('ZIP code not found in RadioReference database. Showing AI results only.');
        } else if (/timeout|timed out/i.test(msg)) {
          setRrWarning('RadioReference timed out. Showing AI results only — try again for full data.');
        } else {
          setRrWarning(`RadioReference unavailable: ${msg}. Showing AI results only.`);
        }
      }
      if (response.data) {
        setResult(response.data);
        setGrounding(response.groundingChunks);
        saveSearchToHistory(query);
        setTimeout(updateStats, 1000);
      } else {
        // Enhance error for ambiguous locations
        if (!isZip && !query.includes(',')) {
          setError(`Could not pinpoint "${query}". Try adding a State (e.g., "${query}, CA") or ZIP code.`);
        } else {
          setError("Could not extract radio data for this location.");
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw e;
      }
      const msg = e.message || "AI Search failed.";
      if (msg.includes("Unable to retrieve")) {
        if (!isZip && !query.includes(',')) {
          setError(`Search failed. Try adding a State (e.g., "${query}, CA") for better accuracy.`);
          return;
        }
      }
      setError(msg);
    }
  };

  // Helper to determine Source Badge style and text
  const getSourceBadge = (source: 'API' | 'AI' | 'Cache') => {
    if (source === 'Cache') {
      return (
        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-purple-900/30 border-purple-500/50 text-purple-400 animate-pulse-subtle">
            <Zap className="w-4 h-4 fill-purple-400" />
            <span className="text-xs font-mono-tech font-bold uppercase tracking-wider"><span className="hidden sm:inline">Source: </span>Cloud Cache</span>
          </div>
          {searchTime > 0 && (
            <div className="text-xs font-mono-tech text-emerald-400 flex items-center gap-1">
              <Timer className="w-3 h-3" />
              {searchTime.toFixed(2)}s
            </div>
          )}
        </div>
      );
    }
    if (source === 'API') {
      return (
        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-green-900/30 border-green-500/50 text-green-400">
            <Database className="w-4 h-4" />
            <span className="text-xs font-mono-tech font-bold uppercase tracking-wider"><span className="hidden sm:inline">Source: </span>RadioReference DB</span>
          </div>
          {searchTime > 0 && (
            <div className="text-xs font-mono-tech text-emerald-400 flex items-center gap-1">
              <Timer className="w-3 h-3" />
              {searchTime.toFixed(2)}s
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-amber-900/30 border-amber-500/50 text-amber-400">
          <Bot className="w-4 h-4" />
          <span className="text-xs font-mono-tech font-bold uppercase tracking-wider"><span className="hidden sm:inline">Source: </span>AI Search</span>
        </div>
        {searchTime > 0 && (
          <div className="text-xs font-mono-tech text-slate-500 flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {searchTime.toFixed(2)}s
          </div>
        )}
      </div>
    );
  };

  // Auth Guard
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
      </div>
    );
  }

  // If not logged in, show auth
  if (!session) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen theme-bg-main theme-text-main pb-24 md:pb-20 selection:bg-amber-500/30 transition-colors duration-300">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800 select-none print-hide">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">

            {/* Left: Logo */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1.5 sm:p-2 bg-gradient-to-tr from-cyan-600 to-blue-700 rounded-lg shadow-lg shadow-blue-900/20 shrink-0">
                <Radio className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base lg:text-xl font-bold text-white tracking-tight font-mono-tech leading-tight">BOY & A SCANNER</h1>
                <p className="hidden sm:block text-[9px] sm:text-[10px] text-cyan-400 font-mono-tech tracking-wider uppercase">Database Access Terminal</p>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 sm:gap-2 lg:gap-3">

              {/* Theme Toggle */}
              <button
                onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>

              {/* External Links - hidden on mobile, visible sm+ */}
              <div className="hidden sm:flex items-center gap-0.5 border-r border-slate-700 pr-2 sm:pr-3 mr-0.5 sm:mr-1">
                <a
                  href="https://boyandascanner.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Main Website"
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-cyan-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <Globe className="w-4 h-4" />
                </a>
                <a
                  href="https://scanner-seo-pages.vercel.app/frequencies"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Frequency Directory"
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-violet-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <List className="w-4 h-4" />
                </a>
                <a
                  href="https://shop.boyandascanner.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Merch Store"
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-pink-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <ShoppingBag className="w-4 h-4" />
                </a>
                <a
                  href="mailto:contact@boyandascanner.com?subject=Feature%20Request:%20Scan%20App"
                  title="Request a Feature"
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </a>
              </div>

              {/* Buy Me A Coffee */}
              <a
                href="https://buymeacoffee.com/boyandascanner"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded bg-[#FFDD00] hover:bg-[#ffea00] text-black font-bold font-mono-tech text-xs transition-transform hover:scale-105 shadow-lg shadow-amber-900/20"
                title="Buy me a coffee"
              >
                <Coffee className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">Support</span>
              </a>

              {/* Hamburger - mobile only */}
              <button
                onClick={() => setShowMobileMenu(prev => !prev)}
                className="md:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Menu"
              >
                {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              {/* Mode Switcher - tablet & desktop only */}
              <div className="hidden md:flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                <button
                  onClick={() => setMode('scan')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-1.5 ${mode === 'scan' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <LocateFixed className="w-3 h-3" /> <span className="hidden lg:inline">LOCAL</span>
                </button>
                <button
                  onClick={() => setMode('trip')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-1.5 ${mode === 'trip' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Map className="w-3 h-3" /> <span className="hidden lg:inline">TRIP</span>
                </button>
                <button
                  onClick={() => setMode('explore')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-1.5 ${mode === 'explore' ? 'bg-cyan-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Globe className="w-3 h-3" /> <span className="hidden lg:inline">EXPLORE</span>
                </button>
                <button
                  onClick={() => setMode('leaderboard')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-1.5 ${mode === 'leaderboard' ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Trophy className="w-3 h-3" /> <span className="hidden lg:inline">RANKS</span>
                </button>
                <button
                  onClick={() => setMode('community')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-1.5 ${mode === 'community' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Users className="w-3 h-3" /> <span className="hidden lg:inline">COMMUNITY</span>
                </button>
              </div>

              {/* Settings + Sign Out */}
              <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 px-2 sm:px-3 py-1.5 gap-2 sm:gap-3">
                {/* Notification Bell */}
                {session && (
                  <div className="relative">
                    <button
                      onClick={handleOpenNotifPanel}
                      title="Notifications"
                      className={`relative transition-colors ${unreadCount > 0 ? 'text-amber-400 hover:text-amber-300' : 'text-slate-400 hover:text-cyan-400'}`}
                    >
                      <Bell className="w-4 h-4" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>
                    {/* Dropdown panel */}
                    {showNotifPanel && (
                      <div className="absolute right-0 top-8 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/60 z-[100] overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                          <span className="text-xs font-bold text-slate-300 font-mono-tech uppercase tracking-wider">Notifications</span>
                          <button onClick={() => setShowNotifPanel(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {notifications.length === 0 ? (
                          <div className="px-4 py-8 text-center text-xs text-slate-500">No notifications yet</div>
                        ) : (
                          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                            {notifications.map(n => (
                              <li key={n.id} className={`px-4 py-3 ${n.read ? 'opacity-60' : ''}`}>
                                <p className="text-xs font-semibold text-slate-200">{n.title}</p>
                                {n.body && <p className="text-[11px] text-slate-400 mt-0.5">{n.body}</p>}
                                <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setShowRRSettings(!showRRSettings)}
                  title="RadioReference Settings"
                  className={`transition-colors ${rrCredentials ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-400 hover:text-amber-400'}`}
                >
                  <Settings className="w-4 h-4" />
                </button>
                {session && (
                  <button
                    onClick={() => setShowProfile(true)}
                    title="Your Profile"
                    className="text-slate-400 hover:text-cyan-400 transition-colors"
                  >
                    <User className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  title="Sign Out"
                  className="text-slate-400 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-slate-800 bg-[#0f172a]/98 backdrop-blur-md pb-2">
            {/* Navigate */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[9px] text-slate-500 font-mono-tech uppercase tracking-widest mb-2">Navigate</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: 'scan',        label: 'LOCAL',     Icon: LocateFixed, color: 'text-cyan-400',   active: 'bg-cyan-600/20 border-cyan-600/40' },
                  { key: 'trip',        label: 'TRIP',      Icon: Map,         color: 'text-amber-400',  active: 'bg-amber-600/20 border-amber-600/40' },
                  { key: 'explore',     label: 'EXPLORE',   Icon: Globe,       color: 'text-cyan-400',   active: 'bg-cyan-700/20 border-cyan-700/40' },
                  { key: 'leaderboard', label: 'RANKS',     Icon: Trophy,      color: 'text-yellow-400', active: 'bg-yellow-600/20 border-yellow-600/40' },
                  { key: 'community',   label: 'COMMUNITY', Icon: Users,       color: 'text-blue-400',   active: 'bg-blue-600/20 border-blue-600/40' },
                ] as const).map(({ key, label, Icon, color, active }) => (
                  <button
                    key={key}
                    onClick={() => { setMode(key); setShowMobileMenu(false); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-mono-tech font-bold transition-colors ${
                      mode === key ? `${color} ${active} border` : 'text-slate-400 border-slate-700 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Links */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[9px] text-slate-500 font-mono-tech uppercase tracking-widest mb-2">Links</p>
              <div className="flex flex-col gap-1">
                <a href="https://boyandascanner.com" target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-cyan-400 transition-colors text-sm">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span>Main Website</span>
                </a>
                <a href="https://scanner-seo-pages.vercel.app/frequencies" target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-violet-400 transition-colors text-sm">
                  <List className="w-4 h-4 text-violet-400" />
                  <span>Frequency Directory</span>
                </a>
                <a href="https://shop.boyandascanner.com" target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-pink-400 transition-colors text-sm">
                  <ShoppingBag className="w-4 h-4 text-pink-400" />
                  <span>Merch Store</span>
                </a>
                <a href="mailto:contact@boyandascanner.com?subject=Feature%20Request:%20Scan%20App"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-emerald-400 transition-colors text-sm">
                  <MessageSquarePlus className="w-4 h-4 text-emerald-400" />
                  <span>Request a Feature</span>
                </a>
                <a href="https://buymeacoffee.com/boyandascanner" target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-amber-400 transition-colors text-sm">
                  <Coffee className="w-4 h-4 text-amber-400" />
                  <span>Support the Project</span>
                </a>
              </div>
            </div>

            {/* Account */}
            <div className="px-4 pt-3 border-t border-slate-800/60 mt-1">
              <p className="text-[9px] text-slate-500 font-mono-tech uppercase tracking-widest mb-2">Account</p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => { setShowRRSettings(true); setShowMobileMenu(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-amber-400 transition-colors text-sm text-left">
                  <Settings className="w-4 h-4 text-amber-400" />
                  <span>RadioReference Settings</span>
                  {rrCredentials && <span className="ml-auto text-[10px] text-emerald-400 font-mono-tech">CONNECTED</span>}
                </button>
                {session && (
                  <button
                    onClick={() => { setShowProfile(true); setShowMobileMenu(false); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-cyan-400 transition-colors text-sm text-left">
                    <User className="w-4 h-4 text-cyan-400" />
                    <span>My Profile</span>
                  </button>
                )}
                <button
                  onClick={() => { handleSignOut(); setShowMobileMenu(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-red-400 transition-colors text-sm text-left">
                  <LogOut className="w-4 h-4 text-red-400" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Mobile Bottom Tab Bar - visible only on mobile (hidden md+) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#0a1120]/95 backdrop-blur-md border-t border-slate-800 mobile-tab-bar">
        <div className="flex items-stretch h-16 max-w-lg mx-auto">
          <button
            onClick={() => setMode('scan')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${mode === 'scan' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {mode === 'scan' && <span className="tab-active-indicator bg-cyan-400" />}
            <LocateFixed className="w-5 h-5" />
            <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">LOCAL</span>
          </button>
          <button
            onClick={() => setMode('trip')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${mode === 'trip' ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {mode === 'trip' && <span className="tab-active-indicator bg-amber-400" />}
            <Map className="w-5 h-5" />
            <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">TRIP</span>
          </button>
          <button
            onClick={() => setMode('explore')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${mode === 'explore' ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {mode === 'explore' && <span className="tab-active-indicator bg-cyan-400" />}
            <Globe className="w-5 h-5" />
            <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">EXPLORE</span>
          </button>
          <button
            onClick={() => setMode('leaderboard')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${mode === 'leaderboard' ? 'text-yellow-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {mode === 'leaderboard' && <span className="tab-active-indicator bg-yellow-400" />}
            <Trophy className="w-5 h-5" />
            <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">RANKS</span>
          </button>
          <button
            onClick={() => setMode('community')}
            className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${mode === 'community' ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            {mode === 'community' && <span className="tab-active-indicator bg-blue-400" />}
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-mono-tech font-bold uppercase tracking-wider">COMMUNITY</span>
          </button>
        </div>
      </div>

      {/* RadioReference Settings Panel */}
      {showRRSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowRRSettings(false)}>
          <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-700 shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-600/20 rounded-lg">
                  <Database className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-mono-tech">RADIOREFERENCE</h3>
                  <p className="text-[10px] text-slate-400 font-mono-tech uppercase tracking-wider">Direct Database Access</p>
                </div>
              </div>
              {rrCredentials && (
                <span className="text-[10px] font-mono-tech text-emerald-400 bg-emerald-900/30 px-2 py-1 rounded-full border border-emerald-500/30">LINKED</span>
              )}
            </div>

            <p className="text-sm text-slate-400 mb-4 leading-relaxed">
              Connect your <strong className="text-white">RadioReference Premium</strong> account to pull <em>verified</em> frequency data directly from the RR database instead of relying on AI search.
            </p>
            <p className="text-xs text-slate-500 -mt-2">
              Credentials are kept for this browser session only and cleared when you close the tab.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">RR Username</label>
                <input
                  type="text"
                  value={rrUsername}
                  onChange={e => setRrUsername(e.target.value)}
                  placeholder="Your RadioReference username"
                  className="w-full bg-[#1e293b] border border-slate-700 rounded px-3 py-2 text-white font-mono-tech text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase">RR Password</label>
                <div className="relative">
                  <input
                    type={showRRPassword ? 'text' : 'password'}
                    value={rrPassword}
                    onChange={e => setRrPassword(e.target.value)}
                    placeholder="Your RadioReference password"
                    className="w-full bg-[#1e293b] border border-slate-700 rounded px-3 py-2 text-white font-mono-tech text-sm focus:border-emerald-500 focus:outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRRPassword(!showRRPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    {showRRPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-slate-950 rounded border border-slate-800">
              <p className="text-[11px] text-slate-500 font-mono-tech leading-relaxed">
                <span className="text-amber-400">NOTE:</span> A <a href="https://www.radioreference.com/apps/subscription/" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">RadioReference Premium subscription</a> is required.
                Your app key is securely stored on the server. ZIP code searches will use the RR database directly; other searches fall back to AI.
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={saveRRCredentials}
                disabled={!rrUsername || !rrPassword}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded font-mono-tech text-sm transition-colors"
              >
                SAVE & CONNECT
              </button>
              {rrCredentials && (
                <button
                  onClick={clearRRCredentials}
                  className="px-4 py-2 bg-red-900/30 border border-red-500/30 text-red-400 rounded font-mono-tech text-sm hover:bg-red-900/50 transition-colors"
                >
                  DISCONNECT
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 selection:bg-amber-500/30">

        {mode === 'leaderboard' ? (
          <Suspense fallback={<SectionLoader label="Loading leaderboard..." />}>
            <Leaderboard currentUserId={session?.user?.id} />
          </Suspense>
        ) : mode === 'trip' ? (
          <Suspense fallback={<SectionLoader label="Loading trip planner..." />}>
            <TripPlanner />
          </Suspense>
        ) : mode === 'explore' ? (
          <Suspense fallback={<SectionLoader label="Loading cache explorer..." />}>
            <ExploreMap isLoggedIn={!!session} />
          </Suspense>
        ) : mode === 'community' ? (
          <Suspense fallback={<SectionLoader label="Loading community hub..." />}>
            <CommunityHub session={session} />
          </Suspense>
        ) : (
          <>
            {/* Search Hero */}
            {!result && !loading && (
              <div className="mt-8 sm:mt-16 text-center max-w-2xl mx-auto animate-fade-in-up">
                <div className="inline-flex items-center justify-center p-4 rounded-full bg-slate-800/50 mb-6 border border-slate-700 shadow-xl shadow-cyan-900/10">
                  <SignalHigh className="w-10 h-10 text-cyan-400" />
                </div>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 sm:mb-6 tracking-tight">
                  Frequency Intelligence. <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Decoded.</span>
                </h2>

                {/* Database Global Stats */}
                {dbCount > 0 && (
                  <div className="mb-8 flex justify-center">
                    <div className="inline-flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg border border-slate-700 shadow-lg">
                      <Database className="w-4 h-4 text-purple-400" />
                      <div className="text-left">
                        <span className="block text-xl font-bold font-mono-tech text-white leading-none">{dbCount}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Community Indexed Locations</span>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-base sm:text-lg text-slate-400 mb-6 sm:mb-10 leading-relaxed px-2">
                  Access the <strong>RadioReference Database</strong> to find Police, Fire, and EMS frequencies for any area.
                  Now featuring <strong>Cross-Reference Verification</strong> for maximum accuracy.
                </p>
                <div className="flex justify-center gap-4 flex-wrap">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-900/20 rounded-full border border-emerald-900/50 text-emerald-400 text-xs font-mono-tech">
                    <ShieldCheck className="w-3 h-3" /> Secure Input Active
                  </div>

                  {/* RadioReference API Status */}
                  {rrCredentials ? (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-900/50 bg-green-900/20 text-green-400 text-xs font-mono-tech">
                      <Database className="w-3 h-3" /> RR Direct API Linked
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowRRSettings(true)}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-900/50 bg-amber-900/20 text-amber-400 text-xs font-mono-tech hover:bg-amber-900/30 transition-colors cursor-pointer"
                    >
                      <Settings className="w-3 h-3" /> Connect RR Account
                    </button>
                  )}

                  {/* Detailed Cache Status Indicator */}
                  {cacheStatus === 'checking' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-700 bg-slate-800 text-slate-400 text-xs font-mono-tech">
                      <Loader2 className="w-3 h-3 animate-spin" /> Connecting...
                    </div>
                  )}
                  {cacheStatus === 'connected' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-900/50 bg-emerald-900/20 text-emerald-400 text-xs font-mono-tech">
                      <Zap className="w-3 h-3 fill-emerald-400" /> Cloud Cache Active
                    </div>
                  )}
                  {cacheStatus === 'offline' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-700 bg-slate-800 text-slate-500 text-xs font-mono-tech">
                      <Zap className="w-3 h-3" /> Cache Offline
                    </div>
                  )}
                  {cacheStatus === 'error' && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-red-900/50 bg-red-900/20 text-red-400 text-xs font-mono-tech" title={cacheErrorMsg}>
                      <AlertCircle className="w-3 h-3" /> Cache Config Error
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Search Input */}
            <div className={`transition-all duration-500 ${!result && !loading ? 'mb-20' : 'mb-8'}`}>
              <SearchForm
                onSearch={(query) => {
                  setSearchQuery(query);
                  // We need to trigger the search logic. The existing handleSearch expects an event, 
                  // but we can extract the logic or just call a new function.
                  // For now, let's adapt:
                  if (!isValidLocationInput(query)) {
                    setError("Security Alert: Invalid characters detected.");
                    return;
                  }
                  if (serviceTypes.length === 0) {
                    setError("Please select at least one service type to scan.");
                    return;
                  }
                  runSearch(query);
                }}
                loading={loading}
                initialQuery={searchQuery}
                onGeoLocation={handleGeoLocation}
                onCancel={handleCancel}
                onInputFocus={() => setShowSuggestions(true)}
                onInputBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />

              {/* Recent Search History Suggestions */}
              <div className="relative max-w-lg mx-auto">
                <SearchSuggestions
                  visible={showSuggestions && !result && !loading}
                  onSelect={(query) => handleFavoriteClick(query)}
                />
              </div>

              {/* Service Filters */}
              <div className="max-w-lg mx-auto mt-4">
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono-tech uppercase tracking-wider text-slate-400 hover:text-white transition-colors bg-slate-800/50 rounded border border-slate-700"
                >
                  <span className="flex items-center gap-2"><Filter className="w-3 h-3" /> Active Filters: <span className="text-cyan-400">{serviceTypes.length} Selected</span></span>
                  {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {
                  showFilters && (
                    <div className="mt-2 p-3 bg-slate-900/50 border border-slate-700 rounded-lg animate-fade-in">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {availableTypes.map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => toggleService(type)}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-medium transition-all border font-mono-tech uppercase ${serviceTypes.includes(type)
                              ? 'bg-amber-600/20 text-amber-400 border-amber-500/50'
                              : 'bg-slate-800 text-slate-500 border-slate-700 hover:bg-slate-700 hover:text-slate-300'
                              }`}
                          >
                            {serviceTypes.includes(type) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                            <span className="truncate">{type}</span>
                          </button>
                        ))}
                      </div>
                      {/* Save as My Defaults */}
                      <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between gap-3">
                        <span className="text-[10px] text-slate-500 font-mono-tech">
                          {session ? 'Synced to your account' : 'Saved locally (sign in to sync)'}
                        </span>
                        <button
                          type="button"
                          onClick={handleSaveDefaults}
                          disabled={prefsSaved}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold font-mono-tech uppercase border transition-all ${prefsSaved
                            ? 'bg-emerald-900/40 border-emerald-600/50 text-emerald-400'
                            : 'bg-slate-800 border-amber-500/50 text-amber-400 hover:bg-amber-900/30 hover:border-amber-400'
                          }`}
                        >
                          {prefsSaved ? <><CheckSquare className="w-3 h-3" /> Saved!</> : <><Star className="w-3 h-3" /> Save as My Defaults</>}
                        </button>
                      </div>
                    </div>
                  )
                }
              </div>

              {/* Saved Locations */}
              {
                favorites.length > 0 && (
                  <div className="max-w-lg mx-auto mt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                      <span className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-500">Saved Locations</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {favorites.map(fav => (
                        <div
                          key={fav.id}
                          className="group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-slate-800/50 hover:bg-amber-900/20 border border-slate-700 hover:border-amber-500/30 rounded-full transition-all cursor-pointer"
                        >
                          <button
                            type="button"
                            onClick={() => handleFavoriteClick(fav.location_query)}
                            className="text-xs font-mono-tech text-slate-300 hover:text-amber-400 transition-colors"
                          >
                            {fav.label || fav.location_query}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFavoriteById(fav.id); }}
                            className="p-0.5 rounded-full text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors md:opacity-0 md:group-hover:opacity-100"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
              {
                error && (
                  <div className="max-w-lg mx-auto mt-4 p-3 border rounded text-sm text-center font-mono-tech animate-pulse flex flex-col items-center gap-3 bg-red-900/20 border-red-900/50 text-red-400">
                    <div className="flex items-center gap-2 font-bold justify-center">
                      <AlertCircle className="w-4 h-4" />
                      <span>{error}</span>
                    </div>
                  </div>
                )
              }
              {
                rrWarning && (
                  <div className="max-w-2xl mx-auto mt-4 p-3 border rounded text-sm font-mono-tech flex items-start gap-3 bg-amber-900/20 border-amber-700/50 text-amber-300">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                    <span className="flex-1">{rrWarning}</span>
                    <button onClick={() => setRrWarning(null)} className="text-amber-500 hover:text-white shrink-0" title="Dismiss">✕</button>
                  </div>
                )
              }
              {
                statusNotice && (
                  <div className={`max-w-2xl mx-auto mt-4 p-3 border rounded text-sm font-mono-tech flex items-start gap-3 ${statusNotice.tone === 'success'
                    ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-300'
                    : statusNotice.tone === 'error'
                      ? 'bg-red-900/20 border-red-700/50 text-red-300'
                      : statusNotice.tone === 'warning'
                        ? 'bg-amber-900/20 border-amber-700/50 text-amber-300'
                        : 'bg-cyan-900/20 border-cyan-700/50 text-cyan-300'
                    }`}>
                    {statusNotice.tone === 'success'
                      ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                    <div className="flex-1">
                      <div>{statusNotice.message}</div>
                      {statusNotice.detail && <div className="mt-1 text-xs opacity-80">{statusNotice.detail}</div>}
                    </div>
                    <button onClick={() => setStatusNotice(null)} className="opacity-70 hover:opacity-100 shrink-0" title="Dismiss">✕</button>
                  </div>
                )
              }
            </div>

            {/* Loading State */}
            {
              loading && !result && (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-cyan-500">
                      <Database className="w-8 h-8 animate-pulse" />
                    </div>
                  </div>
                  <p className="mt-8 text-cyan-400 font-mono-tech text-lg animate-pulse">{searchStep || 'ACCESSING DATABASE...'}</p>
                  <div className="flex gap-2 mt-4">
                    <span className="w-2 h-2 bg-slate-600 rounded-full animate-bounce delay-100"></span>
                    <span className="w-2 h-2 bg-slate-600 rounded-full animate-bounce delay-200"></span>
                    <span className="w-2 h-2 bg-slate-600 rounded-full animate-bounce delay-300"></span>
                  </div>
                </div>
              )
            }

            {/* Results */}
            {
              result && (
                <div className="space-y-8 animate-fade-in">
                  {result.coords && (
                    <Suspense fallback={<SectionLoader label="Loading map..." />}>
                      <MapDisplay coords={result.coords} locationName={result.locationName} />
                    </Suspense>
                  )}

                  <div className="flex flex-wrap justify-center gap-2 sm:gap-4 mb-6">
                    {/* Pin / Compare Button */}
                    {pinnedResult && pinnedResult.locationName !== result.locationName ? (
                      <button
                        onClick={() => setShowComparison(true)}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border bg-cyan-900/40 border-cyan-500/60 text-cyan-400 hover:bg-cyan-900/60 hover:text-white transition-all shadow-lg shadow-cyan-900/20 hover:scale-105"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-columns-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="12" x2="12" y1="3" y2="21" /></svg>
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">Compare with {pinnedResult.locationName.split(',')[0]}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setPinnedResult(pinnedResult?.locationName === result.locationName ? null : result)}
                        className={`inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border transition-all shadow-lg hover:scale-105 ${pinnedResult?.locationName === result.locationName
                          ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-amber-900/20'
                          : 'bg-slate-800/40 border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-white'
                          }`}
                        title="Pin this location to compare with next search"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pin"><line x1="12" x2="12" y1="17" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" /></svg>
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">{pinnedResult?.locationName === result.locationName ? 'Pinned' : 'Pin for Compare'}</span>
                      </button>
                    )}

                    <div className="w-px h-8 bg-slate-700 mx-2 hidden sm:block"></div>

                    {/* Save / Favorite Button */}
                    <button
                      onClick={toggleFavorite}
                      className={`inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border transition-all shadow-lg hover:scale-105 ${isSaved
                        ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-amber-900/20'
                        : 'bg-slate-800/40 border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-white'
                        }`}
                      title={isSaved ? 'Remove from saved locations' : 'Save this location'}
                    >
                      <Star className={`w-5 h-5 ${isSaved ? 'fill-amber-400' : ''}`} />
                      <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">{isSaved ? 'Saved' : 'Save'}</span>
                    </button>

                    <div className="w-px h-8 bg-slate-700 mx-2 hidden sm:block"></div>

                    {getSourceBadge(result.source)}

                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => handleSentinelCopy(result)}
                        className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-amber-900/40 border-amber-500/60 text-amber-400 hover:bg-amber-900/60 hover:text-white transition-all shadow-lg shadow-amber-900/20 hover:scale-105"
                        title="Copy Conventional Frequencies for Uniden Sentinel (Paste)"
                      >
                        <Copy className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider"><span className="hidden sm:inline">Copy for </span>Sentinel</span>
                      </button>
                      <button
                        onClick={() => handleCsvExport(result)}
                        className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-emerald-900/40 border-emerald-500/60 text-emerald-400 hover:bg-emerald-900/60 hover:text-white transition-all shadow-lg shadow-emerald-900/20 hover:scale-105"
                      >
                        <FileDown className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">CSV</span>
                      </button>
                      <button
                        onClick={() => handleChirpExport(result)}
                        className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-violet-900/40 border-violet-500/60 text-violet-400 hover:bg-violet-900/60 hover:text-white transition-all shadow-lg shadow-violet-900/20 hover:scale-105"
                        title="Export CHIRP-format CSV for programming handhelds"
                      >
                        <FileDown className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">CHIRP</span>
                      </button>
                      <button
                        onClick={() => openSds100Modal(result)}
                        className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-amber-900/40 border-amber-500/60 text-amber-400 hover:bg-amber-900/60 hover:text-white transition-all shadow-lg shadow-amber-900/20 hover:scale-105"
                        title="Export SDS100/SDS200 package with selected system types"
                      >
                        <Zap className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">SDS100</span>
                      </button>
                      <button
                        onClick={() => setShowManual(true)}
                        className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-blue-900/40 border-blue-500/60 text-blue-400 hover:bg-blue-900/60 hover:text-white transition-all shadow-lg shadow-blue-900/20 hover:scale-105"
                      >
                        <BookOpen className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">Manual</span>
                      </button>
                      <button
                        onClick={() => window.print()}
                        className="print-hide inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-slate-800/60 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-all shadow-lg hover:scale-105"
                        title="Print / Save as PDF"
                      >
                        <Printer className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider hidden sm:inline">Print</span>
                      </button>
                      {/^\d{5}$/.test(searchQuery.trim()) && (
                        <a
                          href={`https://scanner-seo-pages.vercel.app/frequencies/${searchQuery.trim()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full border bg-violet-900/40 border-violet-500/60 text-violet-400 hover:bg-violet-900/60 hover:text-white transition-all shadow-lg shadow-violet-900/20 hover:scale-105"
                          title="View shareable frequency page"
                        >
                          <List className="w-5 h-5" />
                          <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">Frequency Page</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Contribute button row */}
                  <div className="flex justify-center sm:justify-end mb-4">
                    <button
                      onClick={() => setShowContribute(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/40 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 hover:text-white transition-all text-xs font-bold font-mono-tech"
                      title="Submit a frequency you found in the field (+10 pts)"
                    >
                      <PlusCircle className="w-4 h-4" />
                      Submit a Frequency
                    </button>
                  </div>
                  <FrequencyDisplay
                    data={result}
                    locationQuery={searchQuery}
                    isLoggedIn={!!session}
                      onStatus={pushStatusNotice}
                  />

                  {grounding && grounding.length > 0 && (
                    <div className="mt-12 pt-8 border-t border-slate-800">
                      <h4 className="text-sm uppercase tracking-wider text-slate-500 font-bold mb-4 font-mono-tech flex items-center gap-2">
                        <SignalHigh className="w-4 h-4" /> Verified Sources
                      </h4>
                      <div className="flex flex-wrap gap-3">
                        {grounding.map((chunk, idx) => (
                          chunk.web?.uri ? (
                            <a
                              key={idx}
                              href={chunk.web.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300 transition-colors truncate max-w-xs group"
                            >
                              <ExternalLink className="w-3 h-3 text-cyan-500 group-hover:text-cyan-400" />
                              <span className="truncate">{chunk.web.title || chunk.web.uri}</span>
                            </a>
                          ) : null
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            }

            {
              showManual && result && (
                <Suspense fallback={<SectionLoader label="Loading manual..." />}>
                  <ProgrammingManual
                    data={result}
                    onClose={() => setShowManual(false)}
                  />
                </Suspense>
              )
            }

            {showSds100Modal && result && (
              <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 print-hide">
                <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
                  <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                    <div>
                      <h3 className="text-white font-mono-tech font-bold uppercase tracking-wider">SDS100 Export Options</h3>
                      <p className="text-xs text-slate-400 mt-1">Choose system types to include in your scanner package.</p>
                    </div>
                    <button
                      onClick={() => setShowSds100Modal(false)}
                      className="text-slate-400 hover:text-white"
                      title="Close"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSds100Filters(new Set(Array.from(sds100AvailableFilters)))}
                        className="px-3 py-1.5 rounded border border-cyan-500/50 bg-cyan-900/30 text-cyan-300 text-xs font-mono-tech"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setSds100Filters(new Set())}
                        className="px-3 py-1.5 rounded border border-slate-600 bg-slate-800 text-slate-300 text-xs font-mono-tech"
                      >
                        Clear All
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {SDS100_PRESETS.map((preset) => {
                        const availableCount = preset.keys.filter((key) => sds100AvailableFilters.has(key)).length;
                        const disabled = availableCount === 0;
                        return (
                        <button
                          key={preset.label}
                          onClick={() => applySds100Preset(preset.keys)}
                          disabled={disabled}
                          className={`px-3 py-1.5 rounded border text-xs font-mono-tech ${disabled
                            ? 'border-slate-700 bg-slate-800/50 text-slate-500 cursor-not-allowed'
                            : 'border-violet-500/50 bg-violet-900/30 text-violet-300 hover:bg-violet-900/50'
                            }`}
                          title={disabled ? 'No matching systems for this preset in current results' : `Apply ${preset.label}`}
                        >
                          {preset.label}{!disabled ? ` (${availableCount})` : ''}
                        </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {SDS100_FILTER_OPTIONS.map(option => {
                        const checked = sds100Filters.has(option.key);
                        const available = sds100AvailableFilters.has(option.key);
                        return (
                          <button
                            key={option.key}
                            onClick={() => toggleSds100Filter(option.key)}
                            disabled={!available}
                            className={`text-left p-3 rounded border transition-colors ${!available
                                ? 'border-slate-800 bg-slate-900/40 text-slate-600 cursor-not-allowed'
                                : checked
                                ? 'border-amber-500/70 bg-amber-900/20 text-amber-200'
                                : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                              }`}
                            title={available ? `Toggle ${option.label}` : `No matching ${option.label} systems in current results`}
                          >
                            <div className="flex items-center gap-2">
                              {checked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              <span className="font-mono-tech text-sm font-bold uppercase tracking-wider">{option.label}</span>
                            </div>
                            <div className={`text-[11px] mt-1 ${available ? 'text-slate-400' : 'text-slate-600'}`}>{option.sublabel}</div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-xs text-slate-400 font-mono-tech">
                      Selected: {sds100Filters.size} system type{sds100Filters.size === 1 ? '' : 's'}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-tech">
                      <div className="rounded border border-slate-700 bg-slate-800/60 p-2 text-slate-300">
                        Agencies: <span className="text-white">{sds100ExportSummary.agencies}</span>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-800/60 p-2 text-slate-300">
                        Channels: <span className="text-white">{sds100ExportSummary.channels}</span>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-800/60 p-2 text-slate-300">
                        Systems: <span className="text-white">{sds100ExportSummary.trunkedSystems}</span>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-800/60 p-2 text-slate-300">
                        Talkgroups: <span className="text-white">{sds100ExportSummary.talkgroups}</span>
                      </div>
                    </div>

                    {sds100Filters.size > 0 && sds100ExportSummary.channels === 0 && sds100ExportSummary.trunkedSystems === 0 && (
                      <div className="text-xs text-amber-300 border border-amber-700/60 bg-amber-900/20 rounded p-2 font-mono-tech">
                        No matching systems in current results for selected filters.
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-4 border-t border-slate-700 flex justify-end gap-2">
                    <button
                      onClick={() => setShowSds100Modal(false)}
                      className="px-4 py-2 rounded border border-slate-600 bg-slate-800 text-slate-300 text-sm font-mono-tech"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSds100Export(result)}
                      disabled={sds100Filters.size === 0}
                      className="px-4 py-2 rounded border border-amber-500/70 bg-amber-900/40 text-amber-300 text-sm font-mono-tech disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Download SDS100 Package
                    </button>
                  </div>
                </div>
              </div>
            )}

            {
              showContribute && (
                <Suspense fallback={<SectionLoader label="Loading form..." />}>
                  <ContributeModal
                    locationQuery={searchQuery}
                    onClose={() => setShowContribute(false)}
                  />
                </Suspense>
              )
            }

            {
              showComparison && pinnedResult && result && (
                <Suspense fallback={<SectionLoader label="Loading comparison..." />}>
                  <ComparisonView
                    left={pinnedResult}
                    right={result}
                    onClose={() => setShowComparison(false)}
                  />
                </Suspense>
              )
            }

            {showProfile && session && (
              <Suspense fallback={<SectionLoader label="Loading profile..." />}>
                <ProfileModal session={session} onClose={() => setShowProfile(false)} />
              </Suspense>
            )}
          </>
        )
        }
      </main>

      <footer className="fixed bottom-0 w-full bg-[#0f172a] border-t border-slate-800 py-2 text-center z-40 hidden md:block">
        <div className="flex justify-center items-center gap-2 sm:gap-4 text-[10px] text-slate-600 font-mono-tech uppercase flex-wrap px-4">
          <span>Data by RadioReference.com</span>
          <span className="hidden sm:inline">//</span>
          <span className="hidden sm:inline">Do Not Transmit</span>
          <span>//</span>
          <span className={
            cacheStatus === 'connected' ? 'text-emerald-400' :
              cacheStatus === 'error' ? 'text-red-400' :
                'text-slate-600'
          }>
            CACHE: {cacheStatus.toUpperCase()}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
