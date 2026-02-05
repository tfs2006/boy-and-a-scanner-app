
import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Shield, Radio, Lock, Activity, Zap, Terminal, Map, BookOpen } from 'lucide-react';

export const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!supabase) {
      setError("System Configuration Error: Supabase client not initialized.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin,
        }
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl relative">
        {/* Decorate Lines */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-600"></div>
        
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="relative">
                <div className="absolute -inset-1 bg-cyan-500 rounded-full blur opacity-20 animate-pulse"></div>
                <div className="relative p-4 bg-slate-800 rounded-full border border-slate-700 shadow-inner">
                   <Radio className="w-10 h-10 text-cyan-400" />
                </div>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white text-center font-mono-tech mb-2 tracking-tighter">
            BOY & A SCANNER
          </h1>
          <p className="text-xs text-center text-cyan-500 font-mono-tech uppercase mb-8 tracking-[0.2em]">
            Next-Gen Frequency Intelligence
          </p>

          {/* Marketing / Viral Copy Section */}
          <div className="space-y-5 mb-8">
             <div className="text-center mb-6">
                <h2 className="text-xl text-slate-200 font-bold mb-2">Don't Just Scan. <span className="text-amber-400">Intercept.</span></h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                    The world's first <strong>AI-Powered Radio Scanner Assistant</strong>. 
                    Unlock the hidden analog and digital layers of your city.
                </p>
            </div>

            <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
                    <Map className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wide">Route Recon Trip Planner</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">Map frequencies and trunked systems along your entire drive automatically.</p>
                    </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
                    <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wide">AI Data Verification</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">We cross-reference RadioReference data to ensure you don't program dead channels.</p>
                    </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
                    <BookOpen className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wide">SDS Master Manuals</h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">Instant, step-by-step programming guides for Uniden SDS100/200 scanners.</p>
                    </div>
                </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Terminal Status Box */}
            <div className="bg-slate-950 p-3 rounded border border-slate-800/80">
               <div className="flex items-start gap-3">
                  <Terminal className="w-4 h-4 text-amber-500 mt-1 animate-pulse" />
                  <div className="text-[11px] text-slate-500 font-mono-tech leading-relaxed">
                    <span className="text-emerald-500">System Ready.</span> Awaiting user authentication to decrypt frequency database and route planning engine...
                  </div>
               </div>
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-900/50 rounded flex items-center gap-2 text-red-400 text-xs font-mono-tech">
                <Activity className="w-4 h-4" />
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-white hover:bg-slate-200 text-slate-900 font-bold py-3.5 px-4 rounded-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-lg shadow-cyan-900/20 transform hover:-translate-y-0.5"
            >
              {loading ? (
                <Zap className="w-5 h-5 animate-spin text-slate-900" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              <span className="font-sans">Access the Network</span>
            </button>

          </div>
        </div>
        
        <div className="bg-slate-950 p-3 flex justify-center items-center gap-2 text-[10px] text-slate-600 font-mono-tech uppercase border-t border-slate-800">
             <Lock className="w-3 h-3" />
             <span>Secure Connection Established</span>
        </div>
      </div>
    </div>
  );
};
