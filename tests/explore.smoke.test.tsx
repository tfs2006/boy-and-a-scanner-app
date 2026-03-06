import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const exploreMocks = vi.hoisted(() => {
  const buildMetadataRow = (index: number) => ({
    search_key: `cache-${index}`,
    updated_at: '2026-03-06T00:00:00.000Z',
    locationName: `Location ${index}`,
    coords: { lat: 40 + (index % 5) * 0.01, lng: -116 - (index % 5) * 0.01 },
  });

  const firstPage = Array.from({ length: 250 }, (_, index) => buildMetadataRow(index));
  const secondPage = [buildMetadataRow(250)];

  const from = vi.fn(() => ({
    select: vi.fn((fields: string) => {
      if (fields.includes('locationName:result_data->>locationName')) {
        return {
          order: () => ({
            range: async (start: number) => ({
              data: start === 0 ? firstPage : secondPage,
              error: null,
            }),
          }),
        };
      }

      if (fields === 'result_data') {
        return {
          eq: () => ({
            single: async () => ({
              data: {
                result_data: {
                  source: 'Cache',
                  locationName: 'Location 0',
                  summary: 'Loaded detail',
                  agencies: [],
                  trunkedSystems: [],
                },
              },
              error: null,
            }),
          }),
        };
      }

      return {
        order: () => ({ range: async () => ({ data: [], error: null }) }),
      };
    }),
  }));

  return { from };
});

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(() => ({})),
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ eventHandlers }: { eventHandlers?: { click?: () => void } }) => (
    <button type="button" data-testid="marker" onClick={() => eventHandlers?.click?.()}>
      marker
    </button>
  ),
  useMap: () => ({
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
  }),
}));

vi.mock('../components/FrequencyDisplay', () => ({
  FrequencyDisplay: ({ data }: { data: { locationName: string } }) => <div>{data.locationName}</div>,
}));

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    from: exploreMocks.from,
  },
}));

describe('explore smoke', () => {
  it('loads a first metadata page and can load more markers', async () => {
    const { ExploreMap } = await import('../components/ExploreMap');

    render(<ExploreMap isLoggedIn />);

    await waitFor(() => {
      expect(screen.getByText(/250 locations/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /load more markers/i }));

    await waitFor(() => {
      expect(screen.getByText(/251 locations/i)).toBeInTheDocument();
    });
  });

  it('opens cached detail when a marker is clicked', async () => {
    const { ExploreMap } = await import('../components/ExploreMap');

    render(<ExploreMap isLoggedIn />);

    await waitFor(() => {
      expect(screen.getByText(/250 locations/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTestId('marker')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Location 0')).toHaveLength(2);
      expect(screen.getByText(/0 agencies/i)).toBeInTheDocument();
      expect(screen.getByText('Loaded detail')).toBeInTheDocument();
    });
  });
});