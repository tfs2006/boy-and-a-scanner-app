import React, { useState, useEffect } from 'react';
import { Trophy, Ear, Radio, Flame, Star, Zap, RefreshCw, TrendingUp, Users, Award } from 'lucide-react';
import { LeaderboardEntry, UserStats } from '../types';
import { getLeaderboard, getMyStats, getBadge, getBadgeProgress, getBadgePercent } from '../services/crowdsourceService';

interface LeaderboardProps {
  currentUserId?: string;
}

const BADGE_CONFIG: Record<UserStats['badge'], { color: string; emoji: string }> = {
  Listener:        { color: 'text-slate-400 border-slate-600 bg-slate-800',        emoji: '🎧' },
  Scanner:         { color: 'text-blue-400 border-blue-600/40 bg-blue-900/20',     emoji: '📻' },
  'Pro Scanner':   { color: 'text-purple-400 border-purple-500/40 bg-purple-900/20', emoji: '⚡' },
  'Regional Expert': { color: 'text-amber-400 border-amber-500/40 bg-amber-900/20',  emoji: '🏆' },
  Elite:           { color: 'text-cyan-400 border-cyan-500/40 bg-cyan-900/20',      emoji: '👑' },
};

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <span className="text-xl" title="1st Place">🥇</span>;
  if (rank === 2) return <span className="text-xl" title="2nd Place">🥈</span>;
  if (rank === 3) return <span className="text-xl" title="3rd Place">🥉</span>;
  return (
    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-xs font-mono-tech text-slate-400">
      {rank}
    </span>
  );
};

const StreakBadge: React.FC<{ days: number }> = ({ days }) => {
  if (days < 2) return null;
  const color = days >= 7 ? 'text-amber-400' : days >= 3 ? 'text-orange-400' : 'text-slate-400';
  return (
    <span className={`text-xs font-mono-tech ${color} flex items-center gap-0.5`} title={`${days}-day streak`}>
      <Flame className="w-3 h-3" />
      {days}
    </span>
  );
};

export const Leaderboard: React.FC<LeaderboardProps> = ({ currentUserId }) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myStats, setMyStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'global' | 'my-stats'>('global');

  const load = async () => {
    setLoading(true);
    const [leaderboard, stats] = await Promise.all([
      getLeaderboard(25),
      getMyStats(),
    ]);
    setEntries(leaderboard);
    setMyStats(stats);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const myRank = entries.findIndex(e => e.user_id === currentUserId) + 1;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-amber-600 to-yellow-500 rounded-lg shadow-lg shadow-amber-900/20">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white font-mono-tech tracking-tight">COMMUNITY LEADERBOARD</h2>
            <p className="text-xs text-slate-400 font-mono-tech">Top contributors by points earned</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700 w-fit gap-1">
        <button
          onClick={() => setActiveTab('global')}
          className={`px-4 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2
            ${activeTab === 'global' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <Users className="w-3 h-3" /> Global
        </button>
        <button
          onClick={() => setActiveTab('my-stats')}
          className={`px-4 py-1.5 rounded text-xs font-bold font-mono-tech transition-colors flex items-center gap-2
            ${activeTab === 'my-stats' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <Star className="w-3 h-3" /> My Stats
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          <span className="font-mono-tech text-sm">Loading rankings...</span>
        </div>
      ) : activeTab === 'global' ? (
        <>
          {/* Top-3 podium */}
          {entries.length >= 3 && (
            <div className="grid grid-cols-3 gap-3 mb-2">
              {[entries[1], entries[0], entries[2]].map((entry, i) => {
                const podiumRank = [2, 1, 3][i];
                const heights = ['h-24', 'h-32', 'h-20'];
                const badge = BADGE_CONFIG[entry.badge];
                return (
                  <div key={entry.user_id} className={`flex flex-col items-center justify-end ${heights[i]}`}>
                    <span className="text-lg mb-1">{badge.emoji}</span>
                    <div className={`w-full rounded-t-lg flex flex-col items-center py-2 px-1 border
                      ${podiumRank === 1 ? 'bg-amber-900/30 border-amber-500/40' :
                        podiumRank === 2 ? 'bg-slate-700/50 border-slate-600' :
                          'bg-orange-900/20 border-orange-500/30'}`}
                    >
                      <RankBadge rank={podiumRank} />
                      <span className="text-xs font-bold text-slate-200 font-mono-tech mt-1 truncate max-w-full px-1">
                        {entry.username}
                      </span>
                      <span className={`text-sm font-bold font-mono-tech mt-0.5 ${podiumRank === 1 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {entry.total_points.toLocaleString()} pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Full list */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
            <div className="divide-y divide-slate-700/50">
              {entries.length === 0 && (
                <div className="py-12 text-center text-slate-500 text-sm font-mono-tech">
                  No data yet — be the first to earn points!
                </div>
              )}
              {entries.map((entry) => {
                const isMe = entry.user_id === currentUserId;
                const badge = BADGE_CONFIG[entry.badge];
                return (
                  <div
                    key={entry.user_id}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors
                      ${isMe ? 'bg-cyan-900/20 border-l-2 border-cyan-500' : 'hover:bg-slate-700/30'}`}
                  >
                    <div className="w-8 flex-shrink-0 flex justify-center">
                      <RankBadge rank={entry.rank} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold text-sm font-mono-tech ${isMe ? 'text-cyan-300' : 'text-slate-100'}`}>
                          {entry.username}
                          {isMe && <span className="ml-1 text-[10px] text-cyan-500">(you)</span>}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono-tech font-bold ${badge.color}`}>
                          {badge.emoji} {entry.badge}
                        </span>
                        <StreakBadge days={entry.streak_days} />
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500 font-mono-tech">
                        <span className="flex items-center gap-1"><Ear className="w-3 h-3" />{entry.confirmations_count} heard</span>
                        <span className="flex items-center gap-1"><Radio className="w-3 h-3" />{entry.submissions_count} submitted</span>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold font-mono-tech text-amber-400">{entry.total_points.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 font-mono-tech">points</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {myRank > 0 && (
            <p className="text-center text-xs text-slate-500 font-mono-tech">
              Your rank: <span className="text-cyan-400 font-bold">#{myRank}</span> of {entries.length}
            </p>
          )}
        </>
      ) : (
        /* My Stats Tab */
        myStats ? (
          <div className="space-y-4">
            {/* Profile Card */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-3xl shadow-lg">
                  {BADGE_CONFIG[myStats.badge].emoji}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border font-mono-tech font-bold ${BADGE_CONFIG[myStats.badge].color}`}>
                  {myStats.badge}
                </span>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-2xl font-bold text-white font-mono-tech">{myStats.username}</h3>
                <p className="text-slate-400 text-sm mt-1 font-mono-tech">
                  Next badge: {getBadgeProgress(myStats.total_points)}
                </p>
                {/* Progress bar */}
                <div className="mt-3 bg-slate-700 rounded-full h-2 w-full max-w-xs">
                  <div
                    className="bg-gradient-to-r from-cyan-600 to-amber-500 h-2 rounded-full transition-all"
                    style={{ width: `${getBadgePercent(myStats.total_points)}%` }}
                  />
                </div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold font-mono-tech text-amber-400">{myStats.total_points.toLocaleString()}</div>
                <div className="text-xs text-slate-400 font-mono-tech uppercase tracking-wider">Total Points</div>
                {myStats.streak_days >= 2 && (
                  <div className="mt-2 flex items-center justify-center gap-1 text-orange-400 font-mono-tech text-sm font-bold">
                    <Flame className="w-4 h-4" />
                    {myStats.streak_days}-day streak
                  </div>
                )}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Confirmations', value: myStats.confirmations_count, icon: <Ear className="w-5 h-5 text-emerald-400" />, color: 'text-emerald-400' },
                { label: 'Submissions', value: myStats.submissions_count, icon: <Radio className="w-5 h-5 text-blue-400" />, color: 'text-blue-400' },
                { label: 'Streak Days', value: myStats.streak_days, icon: <Flame className="w-5 h-5 text-orange-400" />, color: 'text-orange-400' },
                { label: 'Global Rank', value: myRank > 0 ? `#${myRank}` : '—', icon: <TrendingUp className="w-5 h-5 text-amber-400" />, color: 'text-amber-400' },
              ].map(stat => (
                <div key={stat.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-center">
                  <div className="flex justify-center mb-2">{stat.icon}</div>
                  <div className={`text-2xl font-bold font-mono-tech ${stat.color}`}>{stat.value}</div>
                  <div className="text-[11px] text-slate-500 font-mono-tech uppercase tracking-wider mt-1">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Points guide */}
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4">
              <h4 className="text-xs font-bold text-slate-400 font-mono-tech uppercase tracking-wider mb-3 flex items-center gap-2">
                <Award className="w-4 h-4" /> How to earn points
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-tech">
                {[
                  { action: '"Heard It" confirmation', pts: '+2 pts', color: 'text-emerald-400' },
                  { action: 'Submit a new frequency', pts: '+10 pts', color: 'text-blue-400' },
                  { action: 'Submission confirmed ×3', pts: '+15 bonus', color: 'text-purple-400' },
                  { action: 'Daily activity streak', pts: '+5 pts/day', color: 'text-orange-400' },
                ].map(item => (
                  <div key={item.action} className="flex justify-between items-center py-1.5 border-b border-slate-700/50">
                    <span className="text-slate-300">{item.action}</span>
                    <span className={`font-bold ${item.color}`}>{item.pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-slate-500 font-mono-tech text-sm">
            No activity yet. Start earning points by clicking <span className="text-emerald-400">"Heard It"</span> on any frequency!
          </div>
        )
      )}
    </div>
  );
};

// getBadgeProgress and getBadgePercent are imported from crowdsourceService (single source of truth)
