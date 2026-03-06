import { beforeEach, describe, expect, it, vi } from 'vitest';

const missingTableError = {
  status: 404,
  code: 'PGRST205',
  message: 'Could not find the table public.notifications in the schema cache',
};

describe('optional Supabase tables', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('stops retrying notification queries after the table is reported missing', async () => {
    const from = vi.fn(() => ({
      select: vi.fn((fields: string) => {
        if (fields === 'id, title, body, read, created_at') {
          return {
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: null, error: missingTableError }),
              }),
            }),
          };
        }

        return {
          eq: () => ({
            eq: async () => ({ count: null, error: missingTableError }),
          }),
        };
      }),
      update: vi.fn(() => ({
        eq: () => ({
          eq: async () => ({ error: missingTableError }),
        }),
      })),
      insert: vi.fn(async () => ({ error: missingTableError })),
    }));

    vi.doMock('../services/supabaseClient', () => ({
      supabase: { from },
    }));

    const { addNotification, getNotifications, getUnreadCount, markAllRead } = await import('../services/notificationsService');

    await expect(getNotifications('user-1')).resolves.toEqual([]);
    await expect(getUnreadCount('user-1')).resolves.toBe(0);
    await expect(markAllRead('user-1')).resolves.toBeUndefined();
    await expect(addNotification('user-1', 'Test')).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledTimes(1);
  });

  it('falls back to local preferences and stops retrying when user_preferences is missing', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: () => ({
          single: async () => ({ data: null, error: { ...missingTableError, message: 'Could not find the table public.user_preferences in the schema cache' } }),
        }),
      })),
      upsert: vi.fn(async () => ({ error: { ...missingTableError, message: 'Could not find the table public.user_preferences in the schema cache' } })),
    }));

    vi.doMock('../services/supabaseClient', () => ({
      supabase: { from },
    }));

    const { loadServicePreferences, saveServicePreferences } = await import('../services/preferencesService');

    await expect(loadServicePreferences('user-1')).resolves.toEqual(['Police', 'Fire', 'EMS']);
    await expect(saveServicePreferences(['Air', 'Railroad'], 'user-1')).resolves.toBeUndefined();
    await expect(loadServicePreferences('user-1')).resolves.toEqual(['Air', 'Railroad']);

    expect(from).toHaveBeenCalledTimes(1);
  });
});