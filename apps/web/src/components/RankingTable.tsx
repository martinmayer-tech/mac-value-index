// The ranking island. It shows the backend's pre-calculated ranking for
// the chosen profile and lets the reader filter and sort it. It never
// calculates a score or a rank.

import type {Condition, FormFactor} from '@mvi/contracts';
import {METRIC_KEYS} from '@mvi/contracts/constants';
import type {JSX} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

import {
  conditionLabel,
  formatGbp,
  formatNumber,
  formatStorage,
} from '../lib/format.js';
import {METRIC_LABELS} from '../lib/ranking-data.js';
import type {
  ProfileFigures,
  RankingData,
  RankingRow,
} from '../lib/ranking-data.js';
import {
  decodeViewState,
  defaultViewState,
  encodeViewState,
  filterOptions,
  initialDirection,
  SORT_KEYS,
  visibleRows,
} from '../lib/view-state.js';
import type {SortKey, ViewState} from '../lib/view-state.js';

interface Props {
  readonly data: RankingData;
}

interface Column {
  readonly key: SortKey;
  readonly label: string;
  readonly numeric: boolean;
}

const COLUMNS: readonly Column[] = [
  {key: 'rank', label: 'Rank', numeric: true},
  {key: 'model', label: 'Model', numeric: false},
  {key: 'chip', label: 'Chip', numeric: false},
  {key: 'ram', label: 'RAM', numeric: true},
  {key: 'ssd', label: 'SSD', numeric: true},
  {key: 'condition', label: 'Condition', numeric: false},
  {key: 'price', label: 'Price', numeric: true},
  {key: 'multiCore', label: 'Multi-core', numeric: true},
  {key: 'capability', label: 'Capability', numeric: true},
  {key: 'value', label: 'Value score', numeric: true},
];

const COLUMN_COUNT = COLUMNS.length + 2;

function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.some(key => key === value);
}

function Detail({
  row,
  figures,
  weights,
}: {
  readonly row: RankingRow;
  readonly figures: ProfileFigures;
  readonly weights: readonly number[];
}): JSX.Element {
  return (
    <div class="detail-grid">
      <div>
        <h4>Score components</h4>
        <dl class="facts">
          {METRIC_KEYS.map((key, index) => (
            <>
              <dt>{METRIC_LABELS[key]}</dt>
              <dd>
                {formatNumber(figures.components[index] ?? 0, 1)} of{' '}
                {weights[index] ?? 0}
              </dd>
            </>
          ))}
          <dt>Capability score</dt>
          <dd>{formatNumber(figures.capabilityScore, 1)} of 100</dd>
        </dl>
      </div>
      <div>
        <h4>Unit costs</h4>
        <dl class="facts">
          <dt>Per 1,000 multi-core points</dt>
          <dd>
            {formatGbp(Math.round(figures.gbpPer1000MultiCore * 100) / 100)}
          </dd>
          <dt>Per GB of RAM</dt>
          <dd>{formatGbp(Math.round(figures.gbpPerGbRam * 100) / 100)}</dd>
          <dt>Per GB of usable storage</dt>
          <dd>
            {figures.gbpPerGbUsableStorage === null
              ? 'Not applicable'
              : formatGbp(
                  Math.round(figures.gbpPerGbUsableStorage * 100) / 100,
                )}
          </dd>
        </dl>
      </div>
      <div>
        <h4>Capacity and source</h4>
        <dl class="facts">
          <dt>Model class</dt>
          <dd>
            {figures.modelClass} ({formatNumber(figures.memoryHeadroomGb)} GB
            headroom)
          </dd>
          <dt>Usable storage</dt>
          <dd>{formatNumber(figures.usableStorageGb)} GB</dd>
          <dt>Warranty</dt>
          <dd>
            {row.warrantyMonths === null
              ? 'Not stated'
              : `${row.warrantyMonths} months`}
          </dd>
          <dt>Source</dt>
          <dd>
            <a href={row.sourceUrl} rel="noopener">
              {row.seller} listing
            </a>
          </dd>
          <dt>Retrieved</dt>
          <dd>{row.retrievedDate}</dd>
        </dl>
      </div>
    </div>
  );
}

export function RankingTable({data}: Props): JSX.Element {
  const [state, setState] = useState<ViewState>(() => defaultViewState(data));
  const [hydrated, setHydrated] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const options = useMemo(() => filterOptions(data), [data]);
  const rows = useMemo(() => visibleRows(data, state), [data, state]);
  const total = useMemo(
    () =>
      data.rows.filter(row => row.figures[state.profile] !== undefined).length,
    [data, state.profile],
  );
  const weights =
    data.profiles.find(profile => profile.id === state.profile)?.weights ?? [];

  // Read the shared view from the URL once the island is interactive.
  useEffect(() => {
    setState(decodeViewState(window.location.search, data));
    setHydrated(true);
  }, [data]);

  // Keep the URL in step, so a view can be shared and survives a reload.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const query = encodeViewState(state, data);
    const url = `${window.location.pathname}${query === '' ? '' : `?${query}`}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, [state, hydrated, data]);

  const update = (changes: Partial<ViewState>): void => {
    setState(current => ({...current, ...changes}));
  };
  const numberOrNull = (value: string): number | null =>
    value === '' ? null : Number(value);
  const sortBy = (key: SortKey): void => {
    setState(current => ({
      ...current,
      sort: key,
      direction:
        current.sort === key
          ? current.direction === 'asc'
            ? 'desc'
            : 'asc'
          : initialDirection(key),
    }));
  };
  const toggleCondition = (condition: Condition, checked: boolean): void => {
    setState(current => ({
      ...current,
      conditions: checked
        ? [...current.conditions, condition]
        : current.conditions.filter(item => item !== condition),
    }));
  };
  const toggleExpanded = (id: string): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };
  const profileName =
    data.profiles.find(profile => profile.id === state.profile)?.name ??
    state.profile;

  return (
    <div class="ranking" data-hydrated={hydrated ? 'true' : 'false'}>
      <fieldset class="ranking-controls" disabled={!hydrated}>
        <legend class="visually-hidden">View controls</legend>
        <div class="field">
          <label htmlFor="ranking-profile">Profile</label>
          <select
            id="ranking-profile"
            value={state.profile}
            onChange={event => {
              update({profile: event.currentTarget.value});
            }}
          >
            {data.profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.id}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label htmlFor="ranking-form">Form factor</label>
          <select
            id="ranking-form"
            value={state.formFactor ?? ''}
            onChange={event => {
              const value = event.currentTarget.value;
              const formFactor: FormFactor | null =
                value === 'desktop' || value === 'laptop' ? value : null;
              update({formFactor});
            }}
          >
            <option value="">Desktops and laptops</option>
            <option value="desktop">Desktops</option>
            <option value="laptop">Laptops</option>
          </select>
        </div>
        <div class="field">
          <label htmlFor="ranking-chip">Chip family</label>
          <select
            id="ranking-chip"
            value={state.chipFamily ?? ''}
            onChange={event => {
              const value = event.currentTarget.value;
              update({chipFamily: value === '' ? null : value});
            }}
          >
            <option value="">Any chip</option>
            {options.chipFamilies.map(family => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label htmlFor="ranking-ram">Minimum RAM</label>
          <select
            id="ranking-ram"
            value={state.minRamGb === null ? '' : String(state.minRamGb)}
            onChange={event => {
              update({minRamGb: numberOrNull(event.currentTarget.value)});
            }}
          >
            <option value="">Any</option>
            {options.ram.map(ram => (
              <option key={ram} value={String(ram)}>
                {ram}GB or more
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label htmlFor="ranking-ssd">Minimum SSD</label>
          <select
            id="ranking-ssd"
            value={state.minSsdGb === null ? '' : String(state.minSsdGb)}
            onChange={event => {
              update({minSsdGb: numberOrNull(event.currentTarget.value)});
            }}
          >
            <option value="">Any</option>
            {options.ssd.map(ssd => (
              <option key={ssd} value={String(ssd)}>
                {formatStorage(ssd)} or more
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label htmlFor="ranking-price">Maximum price (£)</label>
          <input
            id="ranking-price"
            type="number"
            min="0"
            step="100"
            inputMode="numeric"
            value={state.maxPriceGbp === null ? '' : String(state.maxPriceGbp)}
            onInput={event => {
              const value = Number(event.currentTarget.value);
              update({maxPriceGbp: value > 0 ? value : null});
            }}
          />
        </div>
        <fieldset class="field field-wide">
          <legend>Condition</legend>
          <div class="checks">
            {options.conditions.map(condition => (
              <label key={condition}>
                <input
                  type="checkbox"
                  name="condition"
                  value={condition}
                  checked={state.conditions.includes(condition)}
                  onChange={event => {
                    toggleCondition(condition, event.currentTarget.checked);
                  }}
                />
                {conditionLabel(condition)}
              </label>
            ))}
            <button
              type="button"
              class="button"
              onClick={() => {
                setState(defaultViewState(data));
              }}
            >
              Reset view
            </button>
          </div>
        </fieldset>
      </fieldset>
      <noscript>
        <p class="meta">
          Filters, sorting and profile switching need JavaScript. The full
          ranking for the default profile is shown below.
        </p>
      </noscript>

      <div class="cards-sort">
        <div class="field">
          <label htmlFor="ranking-sort">Sort by</label>
          <select
            id="ranking-sort"
            disabled={!hydrated}
            value={state.sort}
            onChange={event => {
              const value = event.currentTarget.value;
              if (isSortKey(value)) {
                update({sort: value, direction: initialDirection(value)});
              }
            }}
          >
            {COLUMNS.map(column => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          class="button"
          disabled={!hydrated}
          onClick={() => {
            update({direction: state.direction === 'asc' ? 'desc' : 'asc'});
          }}
        >
          {state.direction === 'asc' ? 'Ascending' : 'Descending'}
        </button>
      </div>

      <p class="ranking-status" role="status" aria-live="polite">
        Showing {rows.length} of {total} listings ranked under{' '}
        <strong>{profileName}</strong>. Rank is always the rank among all{' '}
        {total} listings, even when filtered.
      </p>

      <table class="ranking-table">
        <caption class="visually-hidden">
          Ranking for the {profileName} profile, sorted by {state.sort},{' '}
          {state.direction === 'asc' ? 'ascending' : 'descending'}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map(column => (
              <th
                key={column.key}
                scope="col"
                class={column.numeric ? 'num' : undefined}
                aria-sort={
                  state.sort === column.key
                    ? state.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  class="sort-button"
                  disabled={!hydrated}
                  onClick={() => {
                    sortBy(column.key);
                  }}
                >
                  {column.label}
                  <span class="sort-indicator" aria-hidden="true">
                    {state.sort === column.key
                      ? state.direction === 'asc'
                        ? '▲'
                        : '▼'
                      : ''}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">Notes</th>
            <th scope="col">
              <span class="visually-hidden">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMN_COUNT}>No listing matches these filters.</td>
            </tr>
          ) : null}
          {rows.map(row => {
            const figures = row.figures[state.profile];
            if (figures === undefined) {
              return null;
            }
            const open = expanded.has(row.id);
            const detailId = `detail-${row.id}`;
            return (
              <>
                <tr key={row.id} class="row" data-listing-id={row.id}>
                  <td class="num" data-label="Rank">
                    {figures.rank}
                  </td>
                  <th scope="row" data-label="Model">
                    <a href={row.sourceUrl} rel="noopener">
                      {row.model}
                    </a>
                  </th>
                  <td data-label="Chip">{row.chipLabel}</td>
                  <td class="num" data-label="RAM">
                    {row.ramGb}GB
                  </td>
                  <td class="num" data-label="SSD">
                    {formatStorage(row.ssdGb)}
                  </td>
                  <td data-label="Condition">
                    {conditionLabel(row.condition)}
                  </td>
                  <td class="num" data-label="Price">
                    {formatGbp(row.priceGbp)}
                  </td>
                  <td class="num" data-label="Multi-core">
                    {row.multiCore === null ? '' : formatNumber(row.multiCore)}
                  </td>
                  <td class="num" data-label="Capability">
                    {formatNumber(figures.capabilityScore, 1)}
                  </td>
                  <td class="num" data-label="Value score">
                    {formatNumber(figures.valueScore, 2)}
                  </td>
                  <td data-label="Notes">
                    {figures.pareto ? <span class="flag">Pareto</span> : null}{' '}
                    {row.stable ? <span class="flag">Stable</span> : null}{' '}
                    {row.agent ? (
                      <span class="flag">Agent-collected</span>
                    ) : null}
                  </td>
                  <td data-label="Details">
                    <button
                      type="button"
                      class="button expand-button"
                      disabled={!hydrated}
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() => {
                        toggleExpanded(row.id);
                      }}
                    >
                      {open ? 'Hide' : 'Details'}
                      <span class="visually-hidden">
                        {' '}
                        for rank {figures.rank}, {row.model}
                      </span>
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr key={detailId} class="detail" id={detailId}>
                    <td colSpan={COLUMN_COUNT}>
                      <Detail row={row} figures={figures} weights={weights} />
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
