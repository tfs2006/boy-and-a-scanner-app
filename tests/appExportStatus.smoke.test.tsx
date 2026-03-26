import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../types';

const searchResult: ScanResult = {
  source: 'API',
  locationName: 'Test County, TS',
  summary: 'Search result',
  agencies: [
    {
      name: 'County Sheriff',
      category: 'Police',
      frequencies: [
        { freq: '155.5500', description: 'Dispatch', mode: 'FM', tag: 'Dispatch' },
      ],
    },
  ],
  trunkedSystems: [],
};

async function renderAppForExportTest(options?: { csvFailureMessage?: string; clipboardReject?: boolean }) {
  vi.doMock('../services/supabaseClient', () => ({
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    },
  }));

  const searchFrequencies = vi.fn().mockResolvedValue({ data: searchResult, groundingChunks: null });

  vi.doMock('../services/geminiService', () => ({
    searchFrequencies,
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
    SearchForm: ({ onSearch }: { onSearch: (query: string) => void }) => (
      <button type="button" onClick={() => onSearch('12345')}>
        trigger search
      </button>
    ),
  }));

  vi.doMock('../components/FrequencyDisplay', () => ({
    FrequencyDisplay: () => <div data-testid="frequency-display" />,
  }));

  vi.doMock('../components/Auth', () => ({
    Auth: () => <div>auth screen</div>,
  }));

  if (options?.csvFailureMessage) {
    vi.doMock('../utils/csvGenerator', () => ({
      generateCSV: vi.fn().mockReturnValue({ ok: false, message: options.csvFailureMessage }),
      generateSmartCSV: vi.fn(),
    }));
  }

  Object.assign(navigator, {
    clipboard: {
      writeText: options?.clipboardReject
        ? vi.fn().mockRejectedValue(new Error('clipboard blocked'))
        : vi.fn().mockResolvedValue(undefined),
    },
  });

  const { default: App } = await import('../App');
  render(<App />);

  fireEvent.click(await screen.findByText('trigger search'));
  await screen.findByTitle('Copy Conventional Frequencies for Uniden Sentinel (Paste)');

  return { searchFrequencies };
}

describe('app export status notices', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sessionStorage.clear();
    localStorage.clear();
  });

  it('shows an error notice when copying Sentinel data to the clipboard fails', async () => {
    await renderAppForExportTest({ clipboardReject: true });

    fireEvent.click(screen.getByTitle('Copy Conventional Frequencies for Uniden Sentinel (Paste)'));

    await waitFor(() => {
      expect(screen.getByText('Failed to copy Sentinel data to the clipboard.')).toBeInTheDocument();
    });
  });

  it('shows an error notice when CSV download creation fails', async () => {
    await renderAppForExportTest({ csvFailureMessage: 'Failed to start the CSV download. Please try again.' });

    fireEvent.click(screen.getByText('CSV'));

    await waitFor(() => {
      expect(screen.getByText('Failed to start the CSV download. Please try again.')).toBeInTheDocument();
    });
  });

  it('shows the RR refresh badge and uses bypass-cache on manual recheck', async () => {
    sessionStorage.setItem('rr_username', 'demo');
    sessionStorage.setItem('rr_password', 'secret');

    const { searchFrequencies } = await renderAppForExportTest();

    searchFrequencies.mockResolvedValueOnce({
      data: searchResult,
      groundingChunks: null,
      searchMeta: { refreshedWithRadioReference: true },
    });

    fireEvent.click(screen.getByText('trigger search'));

    await waitFor(() => {
      expect(screen.getByText('Refreshed with RadioReference')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Refresh RR'));

    await waitFor(() => {
      expect(searchFrequencies).toHaveBeenLastCalledWith('12345', ['Police', 'Fire', 'EMS'], { username: 'demo', password: 'secret' }, expect.any(AbortSignal), { bypassCache: true });
    });
  });
});