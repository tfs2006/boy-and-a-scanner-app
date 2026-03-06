import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/geminiService', () => ({
  planTrip: vi.fn().mockResolvedValue({
    trip: {
      startLocation: 'Boise, ID',
      endLocation: 'Twin Falls, ID',
      locations: [
        {
          locationName: 'Ada County, ID',
          data: {
            source: 'Cache',
            locationName: 'Ada County, ID',
            summary: 'Test route zone',
            agencies: [],
            trunkedSystems: [],
          },
        },
      ],
    },
    groundingChunks: [],
  }),
  filterTripByServices: (trip: unknown) => trip,
}));

vi.mock('../components/FrequencyDisplay', () => ({
  FrequencyDisplay: ({ data }: { data: { locationName: string } }) => <div data-testid="frequency-display">{data.locationName}</div>,
}));

describe('trip smoke', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('submits a route and renders the trip manifest', async () => {
    const { TripPlanner } = await import('../components/TripPlanner');

    render(<TripPlanner />);

    const inputs = screen.getAllByPlaceholderText('City, State or ZIP');
    fireEvent.change(inputs[0], { target: { value: 'Boise, ID' } });
    fireEvent.change(inputs[1], { target: { value: 'Twin Falls, ID' } });

    fireEvent.click(screen.getByRole('button', { name: /calculate route & scan/i }));

    await waitFor(() => {
      expect(screen.getByText(/trip manifest ready/i)).toBeInTheDocument();
    });

    expect(screen.getByTestId('frequency-display')).toHaveTextContent('Ada County, ID');
  });
});