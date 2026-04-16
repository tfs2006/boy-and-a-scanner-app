import { supabase } from './supabaseClient';
import { addNotification } from './notificationsService';
import {
  FrequencyReport,
  FrequencyConfirmationCount,
  LeaderboardEntry,
  UserStats,
} from '../types';
import {
  rememberMissingOptionalTable,
  shouldSkipOptionalTable,
} from './supabaseOptionalTableGuard';

// ---------------------------------------------------------------------------
// Points awarded for each action (mirrors DB trigger logic for display)
// ---------------------------------------------------------------------------
export const POINTS = {
  CONFIRMATION: 2,
  SUBMISSION: 10,
  SUBMISSION_VERIFIED_BONUS: 15,
  DAILY_STREAK: 5,
} as const;

// ---------------------------------------------------------------------------
// Badge thresholds — single source of truth used by both service and UI
// ---------------------------------------------------------------------------
export const BADGE_THRESHOLDS = [
  { badge: 'Scanner',         min: 20 },
  { badge: 'Pro Scanner',     min: 75 },
  { badge: 'Regional Expert', min: 200 },
  { badge: 'Elite',           min: 500 },
] as const;

export function getBadge(points: number): UserStats['badge'] {
  if (points >= 500) return 'Elite';
  if (points >= 200) return 'Regional Expert';
  if (points >= 75) return 'Pro Scanner';
  if (points >= 20) return 'Scanner';
  return 'Listener';
}

export function getBadgeProgress(points: number): string {
  const next = BADGE_THRESHOLDS.find(t => points < t.min);
  if (!next) return 'Max rank reached!';
  return `${next.badge} (${next.min - points} pts away)`;
}

export function getBadgePercent(points: number): number {
  const next = BADGE_THRESHOLDS.find(t => points < t.min);
  if (!next) return 100;
  const prev = BADGE_THRESHOLDS[BADGE_THRESHOLDS.indexOf(next) - 1];
  const floor = prev?.min ?? 0;
  return Math.min(100, Math.round(((points - floor) / (next.min - floor)) * 100));
}

// ---------------------------------------------------------------------------
// Log a "Heard It" confirmation for a specific frequency
// ---------------------------------------------------------------------------
export async function logConfirmation(
  frequency: string,
  locationQuery: string,
  agencyName?: string
): Promise<'confirmed' | 'duplicate' | 'error'> {
  if (!supabase) return 'error';

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'error';

  // Prevent duplicate confirmations within a 1-hour window
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let existingQuery = supabase
    .from('frequency_reports')
    .select('id')
    .eq('user_id', user.id)
    .eq('frequency', frequency.trim())
    .eq('location_query', locationQuery.trim())
    .eq('report_type', 'confirmation')
    .gte('created_at', oneHourAgo);

  existingQuery = agencyName?.trim()
    ? existingQuery.eq('agency_name', agencyName.trim())
    : existingQuery.is('agency_name', null);

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing) return 'duplicate'; // Already confirmed recently

  const { error } = await supabase.from('frequency_reports').insert({
    user_id: user.id,
    report_type: 'confirmation',
    frequency: frequency.trim(),
    location_query: locationQuery.trim(),
    agency_name: agencyName || null,
  });

  if (error) {
    console.error('Error logging confirmation:', error.message);
    return 'error';
  }

  // Update user stats (upsert)
  await incrementUserStat(user.id, 'confirmations_count', POINTS.CONFIRMATION);
  return 'confirmed';
}

// ---------------------------------------------------------------------------
// Submit a new frequency found in the field
// ---------------------------------------------------------------------------
export async function submitFrequency(payload: {
  frequency: string;
  locationQuery: string;
  agencyName: string;
  description: string;
  mode: string;
}): Promise<boolean> {
  if (!supabase) return false;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from('frequency_reports').insert({
    user_id: user.id,
    report_type: 'submission',
    frequency: payload.frequency.trim(),
    location_query: payload.locationQuery.trim(),
    agency_name: payload.agencyName.trim(),
    description: payload.description.trim(),
    mode: payload.mode.trim(),
  });

  if (error) {
    console.error('Error submitting frequency:', error.message);
    return false;
  }

  await incrementUserStat(user.id, 'submissions_count', POINTS.SUBMISSION);
  return true;
}

// ---------------------------------------------------------------------------
// Get confirmation count for a specific frequency + location
// ---------------------------------------------------------------------------
export async function getConfirmationCount(
  frequency: string,
  locationQuery: string
): Promise<FrequencyConfirmationCount> {
  const fallback: FrequencyConfirmationCount = {
    frequency,
    location_query: locationQuery,
    count: 0,
    last_heard: null,
  };

  if (!supabase) return fallback;

  const { data, error } = await supabase
    .from('frequency_reports')
    .select('created_at')
    .eq('frequency', frequency.trim())
    .eq('location_query', locationQuery.trim())
    .eq('report_type', 'confirmation')
    .gte(
      'created_at',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // last 7 days
    )
    .order('created_at', { ascending: false });

  if (error || !data) return fallback;

  return {
    frequency,
    location_query: locationQuery,
    count: data.length,
    last_heard: data[0]?.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Batch-fetch confirmation counts for the full set of frequencies on a result
// ---------------------------------------------------------------------------
export async function getBatchConfirmationCounts(
  rows: Array<{ frequency: string; agencyName?: string }>,
  locationQuery: string
): Promise<Map<string, FrequencyConfirmationCount>> {
  const map = new Map<string, FrequencyConfirmationCount>();
  if (!supabase || rows.length === 0) return map;

  const rowKeys = new Set(rows.map((row) => `${(row.agencyName || '').trim().toLowerCase()}::${row.frequency.trim()}`));
  const uniqueFrequencies = [...new Set(rows.map((row) => row.frequency.trim()))];

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('frequency_reports')
    .select('frequency, agency_name, created_at')
    .in('frequency', uniqueFrequencies)
    .eq('location_query', locationQuery.trim())
    .eq('report_type', 'confirmation')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  if (error || !data) return map;

  for (const row of rows) {
    const key = `${(row.agencyName || '').trim().toLowerCase()}::${row.frequency.trim()}`;
    if (!rowKeys.has(key)) continue;
    const matching = data.filter((record) => record.frequency === row.frequency.trim() && (record.agency_name || '') === (row.agencyName || ''));
    map.set(key, {
      frequency: row.frequency,
      location_query: locationQuery,
      count: matching.length,
      last_heard: matching[0]?.created_at ?? null,
    });
  }

  return map;
}

// ---------------------------------------------------------------------------
// Fetch the global leaderboard (top N users by points)
// ---------------------------------------------------------------------------
export async function getLeaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .order('total_points', { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error('Error fetching leaderboard:', error?.message);
    return [];
  }

  return data.map((row, i) => ({
    ...row,
    rank: i + 1,
    badge: getBadge(row.total_points),
  })) as LeaderboardEntry[];
}

// ---------------------------------------------------------------------------
// Fetch current user's stats
// ---------------------------------------------------------------------------
export async function getMyStats(): Promise<UserStats | null> {
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    ...data,
    badge: getBadge(data.total_points),
  } as UserStats;
}

// ---------------------------------------------------------------------------
// Fetch recent community submissions for a location
// ---------------------------------------------------------------------------
export async function getCommunitySubmissions(
  locationQuery: string,
  limit = 20
): Promise<FrequencyReport[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('frequency_reports')
    .select('*, profiles(username)')
    .eq('location_query', locationQuery.trim())
    .eq('report_type', 'submission')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((r: any) => ({
    ...r,
    username: r.profiles?.username ?? 'Anonymous',
  }));
}

// ---------------------------------------------------------------------------
// Internal helper: upsert user_stats row and accumulate points
// ---------------------------------------------------------------------------
async function incrementUserStat(
  userId: string,
  field: 'confirmations_count' | 'submissions_count',
  points: number
) {
  if (!supabase) return;

  // Try to get existing row
  const { data: existing } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  // Fetch display name from auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const username =
    user?.user_metadata?.username ??
    user?.email?.split('@')[0] ??
    'Anonymous';

  if (existing) {
    // Update streak: if last_activity was yesterday, increment; else reset to 1
    const lastActivity = existing.last_activity
      ? new Date(existing.last_activity)
      : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    let newStreak = existing.streak_days || 1;
    let streakBonus = 0;
    if (lastActivity) {
      const lastDay = new Date(lastActivity);
      lastDay.setHours(0, 0, 0, 0);
      if (lastDay.getTime() === yesterday.getTime()) {
        newStreak = (existing.streak_days || 1) + 1;
        streakBonus = POINTS.DAILY_STREAK;
      } else if (lastDay.getTime() < yesterday.getTime()) {
        newStreak = 1; // streak broken
      }
      // Same day = no change to streak
    }

    const oldPoints = existing.total_points || 0;
    const newPoints = oldPoints + points + streakBonus;
    const oldBadge = getBadge(oldPoints);
    const newBadge = getBadge(newPoints);

    await supabase
      .from('user_stats')
      .update({
        [field]: (existing[field] || 0) + 1,
        total_points: newPoints,
        streak_days: newStreak,
        last_activity: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Notify on badge promotion
    if (oldBadge !== newBadge) {
      await addNotification(userId, `Badge Unlocked: ${newBadge} 🏅`, `You've reached ${newPoints} points and earned the ${newBadge} badge. Keep it up!`);
    }
    // Notify on streak milestones
    const streakMilestones = [7, 14, 30, 60, 100];
    if (streakBonus > 0 && streakMilestones.includes(newStreak)) {
      await addNotification(userId, `${newStreak}-Day Streak! 🔥`, `You've contributed ${newStreak} days in a row. Amazing dedication!`);
    }
  } else {
    // Create new stats row
    await supabase.from('user_stats').insert({
      user_id: userId,
      username,
      total_points: points,
      confirmations_count: field === 'confirmations_count' ? 1 : 0,
      submissions_count: field === 'submissions_count' ? 1 : 0,
      streak_days: 1,
      last_activity: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// "Report Wrong" flags — optional table (frequency_flags).
// If the table doesn't exist yet, every call short-circuits gracefully.
// ---------------------------------------------------------------------------
export type FrequencyFlagReason =
  | 'wrong_frequency'
  | 'off_air'
  | 'bad_agency'
  | 'bad_mode'
  | 'outdated'
  | 'other';

const FLAGS_TABLE = 'frequency_flags';

export async function reportFrequencyWrong(payload: {
  frequency: string;
  locationQuery: string;
  agencyName?: string;
  reason: FrequencyFlagReason;
  note?: string;
}): Promise<'flagged' | 'duplicate' | 'unavailable' | 'error'> {
  if (!supabase) return 'error';
  if (shouldSkipOptionalTable(FLAGS_TABLE)) return 'unavailable';

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'error';

  // Dedupe: same (user, freq, loc, reason) within 24 hours = no-op.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let existing = supabase
    .from(FLAGS_TABLE)
    .select('id')
    .eq('user_id', user.id)
    .eq('frequency', payload.frequency.trim())
    .eq('location_query', payload.locationQuery.trim())
    .eq('reason', payload.reason)
    .gte('created_at', dayAgo);
  existing = payload.agencyName?.trim()
    ? existing.eq('agency_name', payload.agencyName.trim())
    : existing.is('agency_name', null);

  const { data: dupRow, error: dupErr } = await existing.maybeSingle();
  if (dupErr) {
    if (rememberMissingOptionalTable(FLAGS_TABLE, dupErr)) return 'unavailable';
    console.error('[flags] dedupe check failed:', dupErr.message);
    return 'error';
  }
  if (dupRow) return 'duplicate';

  const { error } = await supabase.from(FLAGS_TABLE).insert({
    user_id: user.id,
    frequency: payload.frequency.trim(),
    location_query: payload.locationQuery.trim(),
    agency_name: payload.agencyName?.trim() || null,
    reason: payload.reason,
    note: payload.note?.slice(0, 500) || null,
  });
  if (error) {
    if (rememberMissingOptionalTable(FLAGS_TABLE, error)) return 'unavailable';
    console.error('[flags] insert failed:', error.message);
    return 'error';
  }
  return 'flagged';
}

/**
 * Batch-fetch per-row flag counts for a scan result. Returns a Map keyed
 * exactly like getBatchConfirmationCounts(): `${agencyLower}::${freq}`.
 */
export async function getBatchFlagCounts(
  rows: Array<{ frequency: string; agencyName?: string }>,
  locationQuery: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!supabase || rows.length === 0) return map;
  if (shouldSkipOptionalTable(FLAGS_TABLE)) return map;

  const freqs = [...new Set(rows.map((r) => r.frequency.trim()))];
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(FLAGS_TABLE)
    .select('frequency, agency_name')
    .in('frequency', freqs)
    .eq('location_query', locationQuery.trim())
    .gte('created_at', cutoff);

  if (error) {
    rememberMissingOptionalTable(FLAGS_TABLE, error);
    return map;
  }
  if (!data) return map;

  for (const row of rows) {
    const key = `${(row.agencyName || '').trim().toLowerCase()}::${row.frequency.trim()}`;
    const count = data.filter(
      (rec) =>
        rec.frequency === row.frequency.trim() &&
        (rec.agency_name || '') === (row.agencyName || '')
    ).length;
    if (count > 0) map.set(key, count);
  }
  return map;
}
