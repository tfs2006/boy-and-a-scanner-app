import { supabase } from './supabaseClient';

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export async function getNotifications(userId: string, limit = 20): Promise<AppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data as AppNotification[];
}

export async function getUnreadCount(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) return 0;
  return count ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}

export async function addNotification(userId: string, title: string, body?: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').insert({ user_id: userId, title, body: body ?? null });
}
