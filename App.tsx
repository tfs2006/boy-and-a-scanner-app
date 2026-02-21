
import React, { useState, useEffect } from 'react';
import { Search, Radio, Loader2, MapPin, ExternalLink, SignalHigh, Database, Bot, Map, LocateFixed, ShieldCheck, Zap, AlertCircle, CheckCircle2, Timer, LogOut, User, Navigation, CheckSquare, Square, ChevronDown, ChevronUp, Filter, BookOpen, Coffee, Globe, ShoppingBag, MessageSquarePlus, FileDown, Settings, Eye, EyeOff, Star, X, Copy, Sun, Moon, Trophy, PlusCircle, Ear } from 'lucide-react';
import { searchFrequencies, getDatabaseStats } from './services/geminiService';
import { RRCredentials } from './services/rrApi';
import { SearchResponse, ScanResult, ServiceType } from './types';
import { FrequencyDisplay } from './components/FrequencyDisplay';
import { TripPlanner } from './components/TripPlanner';
import { ProgrammingManual } from './components/ProgrammingManual';
import { Auth } from './components/Auth';
import { isValidLocationInput } from './utils/security';
import { supabase } from './services/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { generateCSV } from './utils/csvGenerator';
import { generateSentinelExport } from './utils/exportUtils';
import { exportSentinelZip } from './utils/sentinelExporter';
import { getFavorites, addFavorite, removeFavorite, Favorite } from './services/favoritesService';
import { SearchSuggestions, saveSearchToHistory } from './components/SearchSuggestions';
import { MapDisplay } from './components/MapDisplay';
import { ComparisonView } from './components/ComparisonView';
import { SearchForm } from './components/SearchForm';
import { Leaderboard } from './components/Leaderboard';
import { ContributeModal } from './components/ContributeModal';
import { ExploreMap } from './components/ExploreMap';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [mode, setMode] = useState<'scan' | 'trip' | 'leaderboard' | 'explore'>('scan');

  // Crowdsource / Contribute Modal
  const [showContribute, setShowContribute] = useState(false);

  // Scan State
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchStep, setSearchStep] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [grounding, setGrounding] = useState<SearchResponse['groundingChunks']>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [isSaved, setIsSaved] = useState(false);

  // Service Filters
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>(['Police', 'Fire', 'EMS']);
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);


  // Comparison State
  const [pinnedResult, setPinnedResult] = useState<ScanResult | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
  const [rrUsername, setRrUsername] = useState(() => localStorage.getItem('rr_username') || '');
  const [rrPassword, setRrPassword] = useState(() => localStorage.getItem('rr_password') || '');
  const [showRRPassword, setShowRRPassword] = useState(false);
  const rrCredentials: RRCredentials | undefined = (rrUsername && rrPassword) ? { username: rrUsername, password: rrPassword } : undefined;

  const saveRRCredentials = () => {
    localStorage.setItem('rr_username', rrUsername);
    localStorage.setItem('rr_password', rrPassword);
    setShowRRSettings(false);
  };

  const clearRRCredentials = () => {
    setRrUsername('');
    setRrPassword('');
    localStorage.removeItem('rr_username');
    localStorage.removeItem('rr_password');
  };

  // Handle Authentication Session
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle Connection Check (Only if logged in)
  useEffect(() => {
    if (session) {
      checkConnection();
      loadFavorites();
    }
  }, [session]);

  // Check if current query is already favorited
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSaved(favorites.some(f => f.location_query.toLowerCase() === searchQuery.trim().toLowerCase()));
    } else {
      setIsSaved(false);
    }
  }, [searchQuery, favorites]);

  const loadFavorites = async () => {
    const favs = await getFavorites();
    setFavorites(favs);
  };

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
    setLoading(true);
    setGrounding(null);
    setSearchTime(0);
    setSearchStep('Initializing Scanner Protocol...');
    const startTime = performance.now();
    performAiSearch(query).catch(err => {
      setError("Search failed. " + (err.message || 'Please try again.'));
    }).finally(() => {
      const endTime = performance.now();
      setSearchTime((endTime - startTime) / 1000);
      setLoading(false);
      setSearchStep('');
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
      const { error } = await supabase.from('search_cache').select('id').limit(1);

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
    if (supabase) {
      await supabase.auth.signOut();
      setResult(null);
      setSearchQuery('');
    }
  };

  const toggleService = (type: ServiceType) => {
    setServiceTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
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

    setLoading(true);
    setError(null);
    setResult(null);
    setGrounding(null);
    setSearchTime(0);
    setSearchStep('Acquiring GPS Satellite Lock...');

    const startTime = performance.now();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const coordString = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        setSearchQuery(coordString);
        try {
          await performAiSearch(coordString);
        } catch (err: any) {
          // If user cancelled manually, we might want to ignore this, but usually performAiSearch handles it.
          // However, if we cleared loading state on cancel, this might set it back?
          // We'll check if loading is still true before setting error.
          setError("Search failed. " + (err.message || 'Please try again.'));
        } finally {
          const endTime = performance.now();
          setSearchTime((endTime - startTime) / 1000);
          setLoading(false);
          setSearchStep('');
        }
      },
      (err) => {
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

    // Store geoId if we want to cancel? 
    // React state for cancelling requires extensive Refactoring. 
    // Ideally we just provide a 'Cancel' button that sets loading=false and ignores the result.
  };

  const handleCancel = () => {
    setLoading(false);
    setSearchStep('');
    setError(null);
    // Note: We can't easily cancel the in-flight fetch or geolocation without AbortController, 
    // but we can reset the UI state so the user isn't stuck.
  };

  const handleSentinelCopy = (data: ScanResult) => {
    const text = generateSentinelExport(data);
    if (!text) {
      alert("No conventional frequencies to export.");
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      alert("Copied to Clipboard! \n\nOpen Uniden Sentinel -> Right Click 'Department' -> Paste.");
    }).catch(err => {
      console.error("Clipboard failed:", err);
      alert("Failed to copy to clipboard.");
    });
  };

  // handleSearch removed - logic moved to SearchForm onSearch prop


  const performAiSearch = async (query: string) => {
    setError(null);
    const isZip = /^\d{5}$/.test(query.trim());
    if (isZip && rrCredentials) {
      setSearchStep('Connecting to RadioReference Database...');
    } else {
      setSearchStep(`Analyzing Location & Scanning for: ${serviceTypes.slice(0, 3).join(', ')}...`);
    }
    try {
      const response = await searchFrequencies(query, serviceTypes, rrCredentials);
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
            <span className="text-xs font-mono-tech font-bold uppercase tracking-wider">Source: Cloud Cache</span>
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
            <span className="text-xs font-mono-tech font-bold uppercase tracking-wider">Source: RadioReference DB</span>
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
          <span className="text-xs font-mono-tech font-bold uppercase tracking-wider">Source: AI Grounded Search</span>
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
    <div className="min-h-screen theme-bg-main theme-text-main pb-20 selection:bg-amber-500/30 transition-colors duration-300">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-[#0f172a]/90 backdrop-blur-md border-b border-slate-800 select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-700 rounded-lg shadow-lg shadow-blue-900/20">
                <Radio className="w-6 h-6 text-white" />
              </div>
              <div className="hidden lg:block">
                <h1 className="text-xl font-bold text-white tracking-tight font-mono-tech">BOY & A SCANNER</h1>
                <p className="text-[10px] text-cyan-400 font-mono-tech tracking-wider uppercase">Database Access Terminal</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Theme Toggle */}
              <button
                onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-colors"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              {/* External Links Toolbar */}
              <div className="flex items-center gap-1 mr-1 sm:mr-3 border-r border-slate-700 pr-2 sm:pr-4">
                <a
                  href="https://boyandascanner.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Main Website"
                  className="p-2 text-slate-400 hover:text-cyan-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <Globe className="w-4 h-4" />
                </a>
                <a
                  href="https://shop.boyandascanner.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Merch Store"
                  className="p-2 text-slate-400 hover:text-pink-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <ShoppingBag className="w-4 h-4" />
                </a>
                <a
                  href="mailto:contact@boyandascanner.com?subject=Feature%20Request:%20Scan%20App"
                  title="Request a Feature"
                  className="p-2 text-slate-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-slate-800"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </a>
              </div>

              {/* Buy Me A Coffee - Highlighted */}
              <a
                href="https://buymeacoffee.com/boyandascanner"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#FFDD00] hover:bg-[#ffea00] text-black font-bold font-mono-tech text-xs transition-transform hover:scale-105 shadow-lg shadow-amber-900/20 mr-2"
                title="Buy me a coffee"
              >
                <Coffee className="w-4 h-4" />
                <span className="hidden sm:inline">Support</span>
              </a>

              {/* Mode Switcher */}
              <div className="hidden md:flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                <button
                  onClick={() => setMode('scan')}
                  className={`px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2 ${mode === 'scan' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <LocateFixed className="w-3 h-3" /> <span className="hidden lg:inline">LOCAL</span>
                </button>
                <button
                  onClick={() => setMode('trip')}
                  className={`px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2 ${mode === 'trip' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Map className="w-3 h-3" /> <span className="hidden lg:inline">TRIP PLAN</span>
                </button>
                <button
                  onClick={() => setMode('explore')}
                  className={`px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2 ${mode === 'explore' ? 'bg-cyan-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Globe className="w-3 h-3" /> <span className="hidden lg:inline">EXPLORE</span>
                </button>
                <button
                  onClick={() => setMode('leaderboard')}
                  className={`px-3 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2 ${mode === 'leaderboard' ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Trophy className="w-3 h-3" /> <span className="hidden lg:inline">LEADERBOARD</span>
                </button>
              </div>

              {/* Mobile Mode Switcher (Icon Only) */}
              <div className="flex md:hidden gap-1">
                <button
                  onClick={() => setMode('scan')}
                  className={`p-2 rounded border border-slate-700 transition-colors ${mode === 'scan' ? 'bg-cyan-900/30 text-cyan-400' : 'text-slate-500'}`}
                  title="Local Scan"
                >
                  <LocateFixed className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMode('trip')}
                  className={`p-2 rounded border border-slate-700 transition-colors ${mode === 'trip' ? 'bg-amber-900/30 text-amber-400' : 'text-slate-500'}`}
                  title="Trip Planner"
                >
                  <Map className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMode('explore')}
                  className={`p-2 rounded border border-slate-700 transition-colors ${mode === 'explore' ? 'bg-cyan-900/30 text-cyan-400' : 'text-slate-500'}`}
                  title="Cache Explorer"
                >
                  <Globe className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMode('leaderboard')}
                  className={`p-2 rounded border border-slate-700 transition-colors ${mode === 'leaderboard' ? 'bg-yellow-900/30 text-yellow-400' : 'text-slate-500'}`}
                  title="Leaderboard"
                >
                  <Trophy className="w-4 h-4" />
                </button>
              </div>

              {/* User / Sign Out */}
              <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 px-3 py-1.5 gap-3">
                <button
                  onClick={() => setShowRRSettings(!showRRSettings)}
                  title="RadioReference Settings"
                  className={`transition-colors ${rrCredentials ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-400 hover:text-amber-400'}`}
                >
                  <Settings className="w-4 h-4" />
                </button>
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
      </nav>

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
              Connect your <strong className="text-white">RadioReference Premium</strong> account to pull <em>verified</em> frequency data directly from the RR database instead of relying on AI search. Your credentials are stored locally in your browser only.
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 selection:bg-amber-500/30">

        {mode === 'leaderboard' ? (
          <Leaderboard currentUserId={session?.user?.id} />
        ) : mode === 'trip' ? (
          <TripPlanner />
        ) : mode === 'explore' ? (
          <ExploreMap isLoggedIn={!!session} />
        ) : (
          <>
            {/* Search Hero */}
            {!result && !loading && (
              <div className="mt-16 text-center max-w-2xl mx-auto animate-fade-in-up">
                <div className="inline-flex items-center justify-center p-4 rounded-full bg-slate-800/50 mb-6 border border-slate-700 shadow-xl shadow-cyan-900/10">
                  <SignalHigh className="w-10 h-10 text-cyan-400" />
                </div>
                <h2 className="text-4xl sm:text-5xl font-bold text-white mb-6 tracking-tight">
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

                <p className="text-lg text-slate-400 mb-10 leading-relaxed">
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
                  setLoading(true);
                  setError(null);
                  setResult(null);
                  setGrounding(null);
                  setSearchTime(0);
                  setSearchStep('Initializing Scanner Protocol...');
                  const startTime = performance.now();

                  // Trigger async search
                  performAiSearch(query).catch(err => {
                    setError("Search failed. " + (err.message || 'Please try again.'));
                  }).finally(() => {
                    const endTime = performance.now();
                    setSearchTime((endTime - startTime) / 1000);
                    setLoading(false);
                    setSearchStep('');
                  });
                }}
                loading={loading}
                initialQuery={searchQuery}
                onGeoLocation={handleGeoLocation}
                onCancel={handleCancel}
              />

              {/* Recent Search History Suggestions */}
              <div className="relative max-w-lg mx-auto">
                <SearchSuggestions
                  visible={!result && !loading}
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
                            className="p-0.5 rounded-full text-slate-600 hover:text-red-400 hover:bg-slate-700 transition-colors opacity-0 group-hover:opacity-100"
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
                    <MapDisplay coords={result.coords} locationName={result.locationName} />
                  )}

                  <div className="flex flex-wrap justify-center gap-4 mb-6">
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
                        className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full border transition-all shadow-lg hover:scale-105 ${pinnedResult?.locationName === result.locationName
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
                      className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full border transition-all shadow-lg hover:scale-105 ${isSaved
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
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border bg-amber-900/40 border-amber-500/60 text-amber-400 hover:bg-amber-900/60 hover:text-white transition-all shadow-lg shadow-amber-900/20 hover:scale-105"
                        title="Copy Conventional Frequencies for Uniden Sentinel (Paste)"
                      >
                        <Copy className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">Copy for Sentinel</span>
                      </button>
                      <button
                        onClick={() => generateCSV(result)}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border bg-emerald-900/40 border-emerald-500/60 text-emerald-400 hover:bg-emerald-900/60 hover:text-white transition-all shadow-lg shadow-emerald-900/20 hover:scale-105"
                      >
                        <FileDown className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">CSV</span>
                      </button>
                      {/* 
                    <button
                      onClick={() => exportSentinelZip(result)}
                      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-amber-900/30 border-amber-500/50 text-amber-400 hover:bg-amber-900/50 hover:text-white transition-colors"
                    >
                      <Zap className="w-4 h-4" />
                      <span className="text-xs font-mono-tech font-bold uppercase tracking-wider">SDS100</span>
                    </button> 
                    */}
                      <button
                        onClick={() => setShowManual(true)}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border bg-blue-900/40 border-blue-500/60 text-blue-400 hover:bg-blue-900/60 hover:text-white transition-all shadow-lg shadow-blue-900/20 hover:scale-105"
                      >
                        <BookOpen className="w-5 h-5" />
                        <span className="text-sm font-mono-tech font-bold uppercase tracking-wider">Manual</span>
                      </button>
                    </div>
                  </div>

                  {/* Contribute button row */}
                  <div className="flex justify-end mb-4">
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
                <ProgrammingManual
                  data={result}
                  onClose={() => setShowManual(false)}
                />
              )
            }

            {
              showContribute && (
                <ContributeModal
                  locationQuery={searchQuery}
                  onClose={() => setShowContribute(false)}
                />
              )
            }

            {
              showComparison && pinnedResult && result && (
                <ComparisonView
                  left={pinnedResult}
                  right={result}
                  onClose={() => setShowComparison(false)}
                />
              )
            }
          </>
        )
        }
      </main>

      <footer className="fixed bottom-0 w-full bg-[#0f172a] border-t border-slate-800 py-2 text-center z-40">
        <div className="flex justify-center items-center gap-4 text-[10px] text-slate-600 font-mono-tech uppercase">
          <span>Data provided by RadioReference.com</span>
          <span>//</span>
          <span>Do Not Transmit</span>
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
