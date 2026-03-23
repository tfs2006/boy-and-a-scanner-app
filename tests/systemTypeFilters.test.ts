import { describe, expect, it } from 'vitest';
import { detectSystemFilters, frequencyMatchesSystemFilter } from '../utils/systemTypeFilters';
import type { ScanResult } from '../types';

describe('system type filters', () => {
  it('does not misclassify EDACS traffic with a NAC as P25 conventional', () => {
    expect(frequencyMatchesSystemFilter({
      freq: '851.0125',
      description: 'Control',
      mode: 'EDACS',
      tag: 'System',
      nac: '293',
    }, 'p25-conv')).toBe(false);
  });

  it('detects conventional and trunked system filter types from a result set', () => {
    const data: ScanResult = {
      source: 'AI',
      locationName: 'Test County, TS',
      summary: 'Test data',
      agencies: [
        {
          name: 'Sheriff',
          category: 'Police',
          frequencies: [
            { freq: '155.100', description: 'Dispatch', mode: 'P25', tag: 'Dispatch', nac: '293' },
          ],
        },
      ],
      trunkedSystems: [
        {
          name: 'Metro EDACS',
          type: 'EDACS Standard',
          location: 'Main Site',
          frequencies: [],
          talkgroups: [],
        },
      ],
    };

    const present = detectSystemFilters(data);

    expect(present.has('p25-conv')).toBe(true);
    expect(present.has('edacs')).toBe(true);
    expect(present.has('analog')).toBe(false);
  });
});