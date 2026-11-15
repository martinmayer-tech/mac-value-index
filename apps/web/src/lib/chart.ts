// Renders the price against capability chart to an SVG string at build
// time with Observable Plot. Positions come straight from results.json.

import type {Condition, ProfileResult, ResultListing} from '@mvi/contracts';
import * as Plot from '@observablehq/plot';
import {JSDOM} from 'jsdom';

import {conditionLabel, formatGbp, formatNumber} from './format.js';

export interface ChartPoint {
  readonly name: string;
  readonly condition: Condition;
  readonly priceGbp: number;
  readonly capabilityScore: number;
  readonly rank: number;
  readonly pareto: boolean;
  readonly top10: boolean;
  readonly tooltip: string;
}

/** Symbol per condition, so condition never relies on colour alone. */
export const CONDITION_SYMBOLS: Readonly<
  Record<Condition, 'circle' | 'square' | 'triangle'>
> = {
  new: 'circle',
  'apple-refurbished': 'square',
  'third-party-refurbished': 'triangle',
};

export function chartPoints(
  result: ProfileResult,
  listings: ReadonlyMap<string, ResultListing>,
  nameOf: (listing: ResultListing) => string,
): readonly ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const entry of result.ranking) {
    const listing = listings.get(entry.listingId);
    if (listing === undefined) {
      continue;
    }
    const name = nameOf(listing);
    points.push({
      name,
      condition: listing.condition,
      priceGbp: listing.priceGbp,
      capabilityScore: entry.capabilityScore,
      rank: entry.rank,
      pareto: entry.isParetoOptimal,
      top10: entry.isTop10,
      tooltip: `${entry.rank}. ${name} (${conditionLabel(listing.condition)}): ${formatGbp(listing.priceGbp)}, capability ${formatNumber(entry.capabilityScore, 1)}${entry.isParetoOptimal ? ', on the Pareto frontier' : ''}`,
    });
  }
  return points;
}

/** Renders the chart as an SVG string. */
export function renderChart(points: readonly ChartPoint[]): string {
  const {document} = new JSDOM('').window;
  const conditions = [...new Set(points.map(point => point.condition))];
  const frontier = points
    .filter(point => point.pareto)
    .sort((a, b) => a.priceGbp - b.priceGbp);
  const top = points.filter(point => point.top10);
  const others = points.filter(point => !point.top10);

  const dots = (
    subset: readonly ChartPoint[],
    className: string,
    radius: number,
  ): Plot.Markish[] =>
    conditions.map(condition =>
      Plot.dot(
        subset.filter(point => point.condition === condition),
        {
          x: 'priceGbp',
          y: 'capabilityScore',
          r: radius,
          symbol: CONDITION_SYMBOLS[condition],
          title: 'tooltip',
          className: `${className} condition-${condition}`,
        },
      ),
    );

  const svg = Plot.plot({
    document,
    width: 960,
    height: 480,
    marginLeft: 56,
    marginBottom: 44,
    marginTop: 20,
    marginRight: 24,
    style: {fontSize: '12px', overflow: 'visible'},
    x: {
      type: 'log',
      label: 'Price (£, log scale)',
      tickFormat: (value: number) => formatGbp(value),
      grid: true,
    },
    y: {label: 'Capability score (0 to 100)', grid: true, nice: true},
    marks: [
      Plot.line(frontier, {
        x: 'priceGbp',
        y: 'capabilityScore',
        curve: 'step-after',
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
        className: 'frontier',
      }),
      ...dots(others, 'others', 3.5),
      ...dots(top, 'top', 6),
      Plot.text(top, {
        x: 'priceGbp',
        y: 'capabilityScore',
        text: (point: ChartPoint) => String(point.rank),
        dy: -13,
        fontSize: 12,
        className: 'rank-label',
      }),
    ],
  });
  // The chart is one image with a text alternative; Plot's per-mark labels
  // are not valid on plain groups, so remove them.
  for (const element of svg.querySelectorAll('[aria-label]')) {
    element.removeAttribute('aria-label');
  }
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-labelledby', 'chart-title chart-desc');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg.outerHTML;
}
