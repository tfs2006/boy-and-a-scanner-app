import { ServiceType } from '../types';
import { supabase } from './supabaseClient';

const LS_KEY = 'prefs_default_service_types';
const DEFAULT_SERVICES: ServiceType[] = ['Police', 'Fire', 'EMS'];

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readFromLocalStorage(): ServiceType[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ServiceType[];
  } catch {/* ignore */}
  return null;
}

function writeToLocalStorage(types: ServiceType[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(types));
  } catch {/* ignore */}
}

// ---------------------------------------------------------------------------
// Supabase helpers (gracefully no-ops if table missing or user unauthed)
// ---------------------------------------------------------------------------

async function readFromSupabase(userId: string): Promise<ServiceType[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('default_service_types')
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    const types = data.default_service_types;
    if (Array.isArray(types) && types.length > 0) return types as ServiceType[];
  } catch {/* table may not exist yet */}
  return null;
}

async function writeToSupabase(userId: string, types: ServiceType[]) {
  if (!supabase) return;
  try {
    await supabase.from('user_preferences').upsert(
      { user_id: userId, default_service_types: types, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  } catch {/* ignore — table may not exist yet */}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the user's default service types.
 * Priority: Supabase (if logged in) > localStorage > hardcoded defaults.
 */
export async function loadServicePreferences(userId?: string): Promise<ServiceType[]> {
  if (userId) {
    const remote = await readFromSupabase(userId);
    if (remote) {
      writeToLocalStorage(remote); // keep local in sync
      return remote;
    }
  }
  return readFromLocalStorage() ?? DEFAULT_SERVICES;
}

/**
 * Save the user's default service types.
 * Always writes to localStorage; also writes to Supabase if logged in.
 */
export async function saveServicePreferences(types: ServiceType[], userId?: string): Promise<void> {
  writeToLocalStorage(types);
  if (userId) await writeToSupabase(userId, types);
}

/**
 * Read defaults synchronously from localStorage only (for initial useState).
 */
export function getLocalServicePreferences(): ServiceType[] {
  return readFromLocalStorage() ?? DEFAULT_SERVICES;
}
