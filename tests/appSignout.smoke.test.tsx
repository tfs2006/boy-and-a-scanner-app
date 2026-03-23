import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('app sign out security', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('clears stored RR credentials when signing out', async () => {
    sessionStorage.setItem('rr_username', 'rr-user');
    sessionStorage.setItem('rr_password', 'rr-pass');
    localStorage.setItem('rr_username', 'legacy-user');
    localStorage.setItem('rr_password', 'legacy-pass');

    let authListener: ((event: string, session: unknown) => void) | undefined;
    const signOut = vi.fn(async () => {
      authListener?.('SIGNED_OUT', null);
    });

    vi.doMock('../services/supabaseClient', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }),
          onAuthStateChange: vi.fn((callback) => {
            authListener = callback;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          }),
          signOut,
        },
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({ error: null }),
          })),
        })),
      },
    }));

    vi.doMock('../services/geminiService', () => ({
      searchFrequencies: vi.fn(),
      getDatabaseStats: vi.fn().mockResolvedValue(0),
    }));

    vi.doMock('../services/favoritesService', () => ({
      getFavorites: vi.fn().mockResolvedValue([]),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
    }));

    vi.doMock('../services/preferencesService', () => ({
      loadServicePreferences: vi.fn().mockResolvedValue(['Police', 'Fire', 'EMS']),
      saveServicePreferences: vi.fn().mockResolvedValue(undefined),
      getLocalServicePreferences: () => ['Police', 'Fire', 'EMS'],
    }));

    vi.doMock('../services/notificationsService', () => ({
      getNotifications: vi.fn().mockResolvedValue([]),
      getUnreadCount: vi.fn().mockResolvedValue(0),
      markAllRead: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../components/SearchSuggestions', () => ({
      SearchSuggestions: () => null,
      saveSearchToHistory: vi.fn(),
    }));

    vi.doMock('../components/SearchForm', () => ({
      SearchForm: () => <div data-testid="search-form" />,
    }));

    vi.doMock('../components/FrequencyDisplay', () => ({
      FrequencyDisplay: () => <div data-testid="frequency-display" />,
    }));

    vi.doMock('../components/Auth', () => ({
      Auth: () => <div>auth screen</div>,
    }));

    const { default: App } = await import('../App');

    render(<App />);

    fireEvent.click(await screen.findByTitle('Sign Out'));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('auth screen')).toBeInTheDocument();
    });

    expect(sessionStorage.getItem('rr_username')).toBeNull();
    expect(sessionStorage.getItem('rr_password')).toBeNull();
    expect(localStorage.getItem('rr_username')).toBeNull();
    expect(localStorage.getItem('rr_password')).toBeNull();
  });
});