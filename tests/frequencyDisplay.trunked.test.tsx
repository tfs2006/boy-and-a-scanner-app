import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../types';

vi.mock('../services/crowdsourceService', () => ({
  logConfirmation: vi.fn(),
  getBatchConfirmationCounts: vi.fn().mockResolvedValue(new Map()),
}));

describe('FrequencyDisplay trunked system UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapses control-channel-only trunked systems until requested', async () => {
    const { FrequencyDisplay } = await import('../components/FrequencyDisplay');

    const data: ScanResult = {
      source: 'API',
      locationName: 'Test County, TS',
      summary: 'Mixed trunked data',
      agencies: [],
      trunkedSystems: [
        {
          name: 'Visible System',
          type: 'P25 Phase I',
          location: 'North Site',
          frequencies: [{ freq: '851.0125', use: 'Control' }],
          talkgroups: [
            { dec: '101', mode: 'D', alphaTag: 'Dispatch', description: 'Law Dispatch', tag: 'Law Dispatch', tagType: 'dispatch' },
          ],
        },
        {
          name: 'Silent System',
          type: 'DMR Trunked',
          location: 'South Site',
          frequencies: [{ freq: '452.1250', use: 'Control' }],
          talkgroups: [],
        },
      ],
    };

    render(<FrequencyDisplay data={data} locationQuery="12345" isLoggedIn={false} />);

    expect(screen.getByText('Visible System')).toBeInTheDocument();
    expect(screen.queryByText('Silent System')).not.toBeInTheDocument();
    expect(screen.getByText('Control-Channel-Only Systems')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /control-channel-only systems/i }));

    expect(screen.getByText('Silent System')).toBeInTheDocument();
  });
});