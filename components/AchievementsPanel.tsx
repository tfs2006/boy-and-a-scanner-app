import React, { useMemo } from 'react';
import { Lock, Trophy } from 'lucide-react';
import { ACHIEVEMENTS, getUnlocked } from '../utils/achievements';

interface AchievementsPanelProps {
  className?: string;
  compact?: boolean;
}

export const AchievementsPanel: React.FC<AchievementsPanelProps> = ({ className = '', compact }) => {
  const unlockedIds = useMemo(() => new Set(getUnlocked()), []);
  const unlockedCount = unlockedIds.size;
  const total = ACHIEVEMENTS.length;
  const points = useMemo(
    () => ACHIEVEMENTS.filter((a) => unlockedIds.has(a.id)).reduce((s, a) => s + a.points, 0),
    [unlockedIds]
  );

  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/70 p-4 ${className}`}>
      <header className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-mono-tech uppercase tracking-wider text-amber-300">
          <Trophy className="w-4 h-4" />
          Achievements
        </h3>
        <span className="text-xs text-slate-400 font-mono-tech">
          {unlockedCount}/{total} · {points} pts
        </span>
      </header>

      <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'} gap-2`}>
        {ACHIEVEMENTS.map((a) => {
          const unlocked = unlockedIds.has(a.id);
          return (
            <div
              key={a.id}
              title={`${a.title} — ${a.description} (+${a.points} pts)`}
              className={`relative rounded-lg border p-2 text-center transition ${
                unlocked
                  ? 'border-amber-500/50 bg-amber-950/20 text-slate-100'
                  : 'border-slate-800 bg-slate-950/70 text-slate-500'
              }`}
            >
              <div className={`text-2xl ${unlocked ? '' : 'grayscale opacity-50'}`} aria-hidden="true">
                {a.icon}
              </div>
              <div className={`mt-1 text-[11px] font-semibold leading-tight ${unlocked ? '' : 'text-slate-400'}`}>
                {a.title}
              </div>
              {!unlocked && (
                <Lock
                  className="absolute top-1 right-1 w-3 h-3 text-slate-600"
                  aria-label="Locked"
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default AchievementsPanel;
