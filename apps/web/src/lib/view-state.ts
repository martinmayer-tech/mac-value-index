// The ranking table's view: profile, filters and sort. Presentation only:
// rows are filtered and ordered, never re-scored or re-ranked.

import type {Condition, FormFactor} from '@mvi/contracts';
import {CONDITIONS, FORM_FACTORS} from '@mvi/contracts/constants';

import type {RankingData, RankingRow} from './ranking-data.js';

export const SORT_KEYS = [
  'rank',
  'model',
  'chip',
  'ram',
  'ssd',
  'condition',
  'price',
  'multiCore',
  'capability',
  'value',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

export interface ViewState {
  readonly profile: string;
  /** Empty means every condition. */
  readonly conditions: readonly Condition[];
  readonly formFactor: FormFactor | null;
  readonly minRamGb: number | null;
  readonly minSsdGb: number | null;
  readonly maxPriceGbp: number | null;
  readonly chipFamily: string | null;
  readonly sort: SortKey;
  readonly direction: SortDirection;
}

export function defaultViewState(data: RankingData): ViewState {
  return {
    profile: data.defaultProfileId,
    conditions: [],
    formFactor: null,
    minRamGb: null,
    minSsdGb: null,
    maxPriceGbp: null,
    chipFamily: null,
    sort: 'rank',
    direction: 'asc',
  };
}

/** The direction a column sorts in when first chosen. */
export function initialDirection(key: SortKey): SortDirection {
  return key === 'multiCore' || key === 'capability' || key === 'value'
    ? 'desc'
    : 'asc';
}

function isOneOf<T extends string>(
  values: readonly T[],
  candidate: string,
): candidate is T {
  return values.some(value => value === candidate);
}

function positiveNumber(text: string | null): number | null {
  if (text === null || text.trim() === '') {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads a view from a URL query string, ignoring anything invalid. */
export function decodeViewState(query: string, data: RankingData): ViewState {
  const params = new URLSearchParams(query);
  const defaults = defaultViewState(data);
  const profile = params.get('profile') ?? '';
  const sort = params.get('sort') ?? '';
  const direction = params.get('dir');
  const formFactor = params.get('form') ?? '';
  const chipFamily = params.get('chip');
  const families = new Set(data.rows.map(row => row.chipFamily));
  const sortKey = isOneOf(SORT_KEYS, sort) ? sort : defaults.sort;
  return {
    profile: data.profiles.some(option => option.id === profile)
      ? profile
      : defaults.profile,
    conditions: CONDITIONS.filter(condition =>
      (params.get('condition') ?? '').split(',').includes(condition),
    ),
    formFactor: isOneOf(FORM_FACTORS, formFactor) ? formFactor : null,
    minRamGb: positiveNumber(params.get('ram')),
    minSsdGb: positiveNumber(params.get('ssd')),
    maxPriceGbp: positiveNumber(params.get('price')),
    chipFamily:
      chipFamily !== null && families.has(chipFamily) ? chipFamily : null,
    sort: sortKey,
    direction:
      direction === 'asc' || direction === 'desc'
        ? direction
        : initialDirection(sortKey),
  };
}

/** Writes a view as a query string, leaving out defaults. */
export function encodeViewState(state: ViewState, data: RankingData): string {
  const params = new URLSearchParams();
  if (state.profile !== data.defaultProfileId) {
    params.set('profile', state.profile);
  }
  if (state.conditions.length > 0) {
    params.set(
      'condition',
      CONDITIONS.filter(c => state.conditions.includes(c)).join(','),
    );
  }
  if (state.formFactor !== null) {
    params.set('form', state.formFactor);
  }
  if (state.minRamGb !== null) {
    params.set('ram', String(state.minRamGb));
  }
  if (state.minSsdGb !== null) {
    params.set('ssd', String(state.minSsdGb));
  }
  if (state.maxPriceGbp !== null) {
    params.set('price', String(state.maxPriceGbp));
  }
  if (state.chipFamily !== null) {
    params.set('chip', state.chipFamily);
  }
  if (state.sort !== 'rank' || state.direction !== 'asc') {
    params.set('sort', state.sort);
    params.set('dir', state.direction);
  }
  return params.toString();
}

/** Rows ranked under the profile that pass every filter. */
export function filterRows(
  rows: readonly RankingRow[],
  state: ViewState,
): readonly RankingRow[] {
  return rows.filter(
    row =>
      row.figures[state.profile] !== undefined &&
      (state.conditions.length === 0 ||
        state.conditions.includes(row.condition)) &&
      (state.formFactor === null || row.formFactor === state.formFactor) &&
      (state.minRamGb === null || row.ramGb >= state.minRamGb) &&
      (state.minSsdGb === null || row.ssdGb >= state.minSsdGb) &&
      (state.maxPriceGbp === null || row.priceGbp <= state.maxPriceGbp) &&
      (state.chipFamily === null || row.chipFamily === state.chipFamily),
  );
}

function sortValue(
  row: RankingRow,
  key: SortKey,
  profile: string,
): number | string {
  const figures = row.figures[profile];
  switch (key) {
    case 'rank':
      return figures?.rank ?? Number.MAX_SAFE_INTEGER;
    case 'model':
      return row.model;
    case 'chip':
      return row.chipLabel;
    case 'ram':
      return row.ramGb;
    case 'ssd':
      return row.ssdGb;
    case 'condition':
      return CONDITIONS.indexOf(row.condition);
    case 'price':
      return row.priceGbp;
    case 'multiCore':
      return row.multiCore ?? 0;
    case 'capability':
      return figures?.capabilityScore ?? 0;
    case 'value':
      return figures?.valueScore ?? 0;
  }
}

/** Orders rows by a column; ties fall back to the backend's rank. */
export function sortRows(
  rows: readonly RankingRow[],
  state: ViewState,
): readonly RankingRow[] {
  const sign = state.direction === 'asc' ? 1 : -1;
  const rankOf = (row: RankingRow): number =>
    row.figures[state.profile]?.rank ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, state.sort, state.profile);
    const right = sortValue(b, state.sort, state.profile);
    const order =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, 'en-GB', {numeric: true})
        : Number(left) - Number(right);
    return order !== 0 ? order * sign : rankOf(a) - rankOf(b);
  });
}

/** Applies the filters and the sort. */
export function visibleRows(
  data: RankingData,
  state: ViewState,
): readonly RankingRow[] {
  return sortRows(filterRows(data.rows, state), state);
}

/** Distinct values offered by the filter controls, from the data itself. */
export function filterOptions(data: RankingData): {
  readonly ram: readonly number[];
  readonly ssd: readonly number[];
  readonly chipFamilies: readonly string[];
  readonly conditions: readonly Condition[];
} {
  const numeric = (values: readonly number[]): readonly number[] =>
    [...new Set(values)].sort((a, b) => a - b);
  return {
    ram: numeric(data.rows.map(row => row.ramGb)),
    ssd: numeric(data.rows.map(row => row.ssdGb)),
    chipFamilies: [...new Set(data.rows.map(row => row.chipFamily))].sort(
      (a, b) => a.localeCompare(b, 'en-GB', {numeric: true}),
    ),
    conditions: CONDITIONS.filter(condition =>
      data.rows.some(row => row.condition === condition),
    ),
  };
}
