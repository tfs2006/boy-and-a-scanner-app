import React, { useEffect, useState } from 'react';
import { X, Save, Radio, Zap, Star, Flame, Trophy, MapPin, BookOpen } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { getMyStats } from '../services/crowdsourceService';
import { UserStats } from '../types';
import { Session } from '@supabase/supabase-js';

interface Props {
  session: Session;
  onClose: () => void;
}

interface Profile {
  username: string;
  scanner_model: string;
  avatar_url: string | null;
  bio: string;
  location_display: string;
  frequency_interests: string[];
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('') || '??';
}

function getAvatarColor(name: string): string {
  const colors = [
    'from-cyan-600 to-blue-700',
    'from-violet-600 to-purple-700',
    'from-emerald-600 to-teal-700',
    'from-amber-600 to-orange-700',
    'from-rose-600 to-pink-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function ProfileModal({ session, onClose }: Props) {
  const [profile, setProfile] = useState<Profile>({ username: '', scanner_model: '', avatar_url: null, bio: '', location_display: '', frequency_interests: [] });
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase.from('profiles').select('username, scanner_model, avatar_url, bio, location_display, frequency_interests').eq('user_id', session.user.id).maybeSingle(),
      getMyStats(),
    ]).then(([profileRes, statsData]) => {
      if (profileRes.data) {
        setProfile({
          username:             profileRes.data.username ?? '',
          scanner_model:        profileRes.data.scanner_model ?? '',
          avatar_url:           profileRes.data.avatar_url ?? null,
          bio:                  profileRes.data.bio ?? '',
          location_display:     profileRes.data.location_display ?? '',
          frequency_interests:  profileRes.data.frequency_interests ?? [],
        });
      } else {
        // Fall back to auth metadata
        setProfile(p => ({
          ...p,
          username: session.user.user_metadata?.username ?? session.user.email?.split('@')[0] ?? '',
        }));
      }
      setStats(statsData);
      setLoading(false);
    });
  }, [session]);

  const handleSave = async () => {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('profiles').upsert(
      {
        user_id:              session.user.id,
        username:             profile.username.trim(),
        scanner_model:        profile.scanner_model.trim(),
        bio:                  profile.bio.trim() || null,
        location_display:     profile.location_display.trim() || null,
        frequency_interests:  profile.frequency_interests,
      },
      { onConflict: 'user_id' }
    );
    if (err) {
      setError('Save failed: ' + err.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  };

  const initials = getInitials(profile.username || 'User');
  const avatarGrad = getAvatarColor(profile.username || 'X');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-md bg-[#0f182a] border border-slate-700 rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors"><X className="w-5 h-5" /></button>

        <h2 className="text-lg font-bold text-white font-mono-tech uppercase tracking-wider mb-5">Your Profile</h2>

        {loading ? (
          <div className="flex justify-center py-8 text-slate-500 text-sm">Loading…</div>
        ) : (
          <div className="space-y-5">
            {/* Avatar + initials */}
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full bg-gradient-to-tr ${avatarGrad} flex items-center justify-center text-white text-2xl font-bold font-mono-tech shrink-0`}>
                {initials}
              </div>
              <div>
                <p className="text-sm text-slate-300 font-semibold">{profile.username || 'Unnamed'}</p>
                <p className="text-xs text-slate-500">{session.user.email}</p>
                {stats && (
                  <p className="text-xs text-cyan-400 font-mono-tech mt-0.5">{stats.badge} · {stats.total_points} pts</p>
                )}
              </div>
            </div>

            {/* Stats strip */}
            {stats && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                  <Trophy className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                  <p className="text-base font-bold text-white font-mono-tech">{stats.total_points}</p>
                  <p className="text-[10px] text-slate-500 uppercase">Points</p>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                  <Flame className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                  <p className="text-base font-bold text-white font-mono-tech">{stats.streak_days}</p>
                  <p className="text-[10px] text-slate-500 uppercase">Streak</p>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3 text-center">
                  <Zap className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                  <p className="text-base font-bold text-white font-mono-tech">{stats.confirmations_count + stats.submissions_count}</p>
                  <p className="text-[10px] text-slate-500 uppercase">Reports</p>
                </div>
              </div>
            )}

            {/* Editable fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase font-mono-tech mb-1">Display Name</label>
                <input
                  type="text"
                  value={profile.username}
                  onChange={e => setProfile(p => ({ ...p, username: e.target.value }))}
                  maxLength={40}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono-tech focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20"
                  placeholder="Your callsign or nickname"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase font-mono-tech mb-1 flex items-center gap-1.5"><Radio className="w-3 h-3" /> Scanner Model</label>
                <input
                  type="text"
                  value={profile.scanner_model}
                  onChange={e => setProfile(p => ({ ...p, scanner_model: e.target.value }))}
                  maxLength={60}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono-tech focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20"
                  placeholder="e.g. Uniden SDS200, BCD536HP…"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase font-mono-tech mb-1 flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Location (optional)</label>
                <input
                  type="text"
                  value={profile.location_display}
                  onChange={e => setProfile(p => ({ ...p, location_display: e.target.value }))}
                  maxLength={80}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono-tech focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20"
                  placeholder="e.g. Nashville, TN"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase font-mono-tech mb-1 flex items-center gap-1.5"><BookOpen className="w-3 h-3" /> Bio (optional)</label>
                <textarea
                  value={profile.bio}
                  onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                  maxLength={280}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono-tech focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 resize-none"
                  placeholder="Tell the community a bit about yourself…"
                />
                <div className="text-right text-[10px] text-slate-600 -mt-0.5">{profile.bio.length}/280</div>
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handleSave}
              disabled={saving || !profile.username.trim()}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold font-mono-tech uppercase tracking-wider transition-all ${saved ? 'bg-emerald-600 text-white' : 'bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50'}`}
            >
              {saved ? <><Star className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Profile'}</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
