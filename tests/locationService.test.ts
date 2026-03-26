import { describe, expect, it } from 'vitest';

import { createLocationCacheKeys } from '../services/locationService';
import type { ResolvedLocation } from '../services/locationService';

describe('locationService cache key convergence', () => {
  it('generates equivalent v7 and legacy keys for ZIP, city, county, and saint/st aliases', () => {
    const resolvedLocation: ResolvedLocation = {
      type: 'city',
      standardizedName: 'St George, UT',
      canonicalName: 'Washington County, UT',
      canonicalKey: 'v7_loc_county_washington_ut',
      searchLabel: 'St George, UT | Washington County, UT | ZIP 84770',
      isZip: false,
      primaryZip: '84770',
      city: 'St George',
      county: 'Washington',
      stateCode: 'UT',
      zips: ['84770'],
      aliases: ['St George, UT', 'Washington County, UT', '84770', 'Saint George, UT'],
    };

    const keys = createLocationCacheKeys('saint george utah', resolvedLocation);

    expect(keys).toContain('v7_loc_county_washington_ut');
    expect(keys).toContain('v7_loc_city_st_george_ut');
    expect(keys).toContain('v7_loc_city_saint_george_ut');
    expect(keys).toContain('v7_loc_zip_84770');
    expect(keys).toContain('v6_loc_84770');
    expect(keys).toContain('v6_loc_stgeorge,ut');
    expect(keys).toContain('v6_loc_saintgeorge,ut');
  });
});