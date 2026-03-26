import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchForm } from '../components/SearchForm';

describe('SearchForm guidance', () => {
  it('shows interpreted scope details and refinement chips', () => {
    const onSearch = vi.fn();

    render(
      <SearchForm
        onSearch={onSearch}
        loading={false}
        interpretedLocationLabel="St George, UT | Washington County, UT | ZIP 84770"
        interpretedScopeLabel="Resolved to St George, UT with countywide coverage via ZIP 84770."
        refinementOptions={[
          { label: 'Use ZIP 84770', query: '84770', kind: 'zip' },
          { label: 'Use Washington County, UT', query: 'Washington County, UT', kind: 'county' },
        ]}
      />
    );

    expect(screen.getByText('Interpreted Scope')).toBeInTheDocument();
    expect(screen.getByText('Resolved to St George, UT with countywide coverage via ZIP 84770.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Use ZIP 84770'));
    expect(onSearch).toHaveBeenCalledWith('84770');
  });
});