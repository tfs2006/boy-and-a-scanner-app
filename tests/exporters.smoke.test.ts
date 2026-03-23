import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../types';

const sampleScan: ScanResult = {
  source: 'API',
  locationName: 'Test County, TS',
  summary: 'Export data',
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

describe('export helper failure handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a CSV failure result when the browser download cannot start', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('download failed');
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { generateCSV } = await import('../utils/csvGenerator');
    const result = generateCSV(sampleScan);

    expect(result).toEqual({
      ok: false,
      message: 'Failed to start the CSV download. Please try again.',
    });
  });

  it('returns a CHIRP failure result when the browser download cannot start', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('download failed');
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { exportChirpCSV } = await import('../utils/chirpExporter');
    const result = exportChirpCSV(sampleScan);

    expect(result).toEqual({
      ok: false,
      message: 'Failed to start the CHIRP download. Please try again.',
    });
  });
});