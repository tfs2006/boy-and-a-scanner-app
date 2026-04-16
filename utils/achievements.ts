// ---------------------------------------------------------------------------
// Local-first achievements system.
//
// Every achievement is evaluated client-side against a small "stats" blob
// stored in localStorage. Unlock events fire a CustomEvent so the UI can
// show a celebration toast without tight coupling.
// ---------------------------------------------------------------------------

export type AchievementId =
  | 'first_scan'
  | 'ten_scans'
  | 'fifty_scans'
  | 'hundred_scans'
  | 'week_streak'
  | 'month_streak'
  | 'first_share'
  | 'first_confirm'
  | 'first_submit'
  | 'daily_done'
  | 'five_dailies'
  | 'trip_planner';

export interface Achievement {
  id: AchievementId;
  title: string;
  description: string;
  points: number;
  icon: string; // emoji — keeps it dependency-free for share cards
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_scan',    title: 'First Contact',       description: 'Complete your very first scan.',             points: 5,  icon: '📡' },
  { id: 'ten_scans',     title: 'Tuning In',           description: 'Complete 10 scans.',                         points: 10, icon: '🎧' },
  { id: 'fifty_scans',   title: 'Band Scanner',        description: 'Complete 50 scans.',                         points: 25, icon: '📻' },
  { id: 'hundred_scans', title: 'Centurion',           description: 'Complete 100 scans.',                        points: 50, icon: '🏅' },
  { id: 'week_streak',   title: '7-Day Streak',        description: 'Scan on 7 consecutive days.',                points: 20, icon: '🔥' },
  { id: 'month_streak',  title: '30-Day Streak',       description: 'Scan on 30 consecutive days.',               points: 60, icon: '⚡' },
  { id: 'first_share',   title: 'Signal Boost',        description: 'Share your first scan result.',              points: 5,  icon: '📣' },
  { id: 'first_confirm', title: 'Eyes On',             description: 'Log your first "Heard It" confirmation.',    points: 5,  icon: '👀' },
  { id: 'first_submit',  title: 'Field Agent',         description: 'Submit your first new frequency.',           points: 15, icon: '🗒️' },
  { id: 'daily_done',    title: 'Daily Driver',        description: 'Complete your first daily challenge.',       points: 10, icon: '🎯' },
  { id: 'five_dailies',  title: 'Streak Machine',      description: 'Complete 5 daily challenges.',               points: 25, icon: '🚀' },
  { id: 'trip_planner',  title: 'Road Tripper',        description: 'Plan your first multi-zone trip.',           points: 10, icon: '🗺️' },
];

const STORAGE_KEY = 'achievements_v1';
const STATS_KEY   = 'achievement_stats_v1';
const EVENT_NAME  = 'baas:achievement-unlocked';

export interface AchievementStats {
  scans: number;
  streakDays: number;
  shares: number;
  confirms: number;
  submits: number;
  dailiesDone: number;
  tripsPlanned: number;
}

const DEFAULT_STATS: AchievementStats = {
  scans: 0,
  streakDays: 0,
  shares: 0,
  confirms: 0,
  submits: 0,
  dailiesDone: 0,
  tripsPlanned: 0,
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function getStats(): AchievementStats {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_STATS };
  return { ...DEFAULT_STATS, ...safeParse<Partial<AchievementStats>>(localStorage.getItem(STATS_KEY), {}) };
}

export function getUnlocked(): AchievementId[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse<AchievementId[]>(localStorage.getItem(STORAGE_KEY), []);
}

function setUnlocked(ids: AchievementId[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function setStats(s: AchievementStats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function evaluateAchievements(stats: AchievementStats, already: AchievementId[]): AchievementId[] {
  const unlocked = new Set(already);
  const check = (id: AchievementId, condition: boolean) => {
    if (condition && !unlocked.has(id)) unlocked.add(id);
  };
  check('first_scan',    stats.scans >= 1);
  check('ten_scans',     stats.scans >= 10);
  check('fifty_scans',   stats.scans >= 50);
  check('hundred_scans', stats.scans >= 100);
  check('week_streak',   stats.streakDays >= 7);
  check('month_streak',  stats.streakDays >= 30);
  check('first_share',   stats.shares >= 1);
  check('first_confirm', stats.confirms >= 1);
  check('first_submit',  stats.submits >= 1);
  check('daily_done',    stats.dailiesDone >= 1);
  check('five_dailies',  stats.dailiesDone >= 5);
  check('trip_planner',  stats.tripsPlanned >= 1);
  return [...unlocked];
}

export interface UnlockEventDetail {
  achievement: Achievement;
}

function emitUnlock(id: AchievementId) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UnlockEventDetail>(EVENT_NAME, { detail: { achievement: a } }));
}

/**
 * Increment one or more stat fields and re-evaluate achievements.
 * Returns any newly-unlocked achievement objects so callers can react
 * synchronously (e.g. set points) without waiting for the event.
 */
export function trackStat(delta: Partial<AchievementStats>): Achievement[] {
  const prev = getStats();
  const next: AchievementStats = { ...prev };
  (Object.keys(delta) as Array<keyof AchievementStats>).forEach((k) => {
    const inc = delta[k] ?? 0;
    if (typeof inc === 'number') next[k] = Math.max(0, (prev[k] || 0) + inc);
  });
  setStats(next);

  const before = getUnlocked();
  const after = evaluateAchievements(next, before);
  const freshIds = after.filter((id) => !before.includes(id));
  if (freshIds.length > 0) {
    setUnlocked(after);
    for (const id of freshIds) emitUnlock(id);
  }
  return freshIds.map((id) => ACHIEVEMENTS.find((a) => a.id === id)!).filter(Boolean);
}

/**
 * Directly set the streak value (replacing, not adding) and re-evaluate.
 */
export function setStreak(days: number): Achievement[] {
  const prev = getStats();
  const next = { ...prev, streakDays: Math.max(0, Math.floor(days)) };
  setStats(next);

  const before = getUnlocked();
  const after = evaluateAchievements(next, before);
  const freshIds = after.filter((id) => !before.includes(id));
  if (freshIds.length > 0) {
    setUnlocked(after);
    for (const id of freshIds) emitUnlock(id);
  }
  return freshIds.map((id) => ACHIEVEMENTS.find((a) => a.id === id)!).filter(Boolean);
}

export function onAchievementUnlocked(
  handler: (a: Achievement) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<UnlockEventDetail>).detail;
    if (detail?.achievement) handler(detail.achievement);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

export function getAchievementSummary(): {
  unlocked: Achievement[];
  locked: Achievement[];
  points: number;
} {
  const ids = new Set(getUnlocked());
  const unlocked = ACHIEVEMENTS.filter((a) => ids.has(a.id));
  const locked   = ACHIEVEMENTS.filter((a) => !ids.has(a.id));
  const points   = unlocked.reduce((s, a) => s + a.points, 0);
  return { unlocked, locked, points };
}
