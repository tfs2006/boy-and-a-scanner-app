import { supabase } from './supabaseClient';
import { rememberMissingOptionalTable, shouldSkipOptionalTable } from './supabaseOptionalTableGuard';

const NOTIFICATIONS_TABLE = 'notifications';

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export async function getNotifications(userId: string, limit = 20): Promise<AppNotification[]> {
  if (!supabase || shouldSkipOptionalTable(NOTIFICATIONS_TABLE)) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (rememberMissingOptionalTable(NOTIFICATIONS_TABLE, error)) return [];
  if (error) return [];
  return data as AppNotification[];
}

export async function getUnreadCount(userId: string): Promise<number> {
  if (!supabase || shouldSkipOptionalTable(NOTIFICATIONS_TABLE)) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (rememberMissingOptionalTable(NOTIFICATIONS_TABLE, error)) return 0;
  if (error) return 0;
  return count ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  if (!supabase || shouldSkipOptionalTable(NOTIFICATIONS_TABLE)) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);

  rememberMissingOptionalTable(NOTIFICATIONS_TABLE, error);
}

export async function addNotification(userId: string, title: string, body?: string): Promise<void> {
  if (!supabase || shouldSkipOptionalTable(NOTIFICATIONS_TABLE)) return;
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, body: body ?? null });
  rememberMissingOptionalTable(NOTIFICATIONS_TABLE, error);
}
