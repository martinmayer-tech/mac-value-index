// Display formatting only. No figure is calculated here.

import type {Condition} from '@mvi/contracts';

const gbpWhole = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});
const gbpPence = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** GBP with thousands separators; pence only when there are any. */
export function formatGbp(amount: number): string {
  const wholePounds = Math.round(amount * 100) % 100 === 0;
  return (wholePounds ? gbpWhole : gbpPence).format(amount);
}

/** A number with thousands separators, rounded for display. */
export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Storage as marketed: 512GB, 1TB, 2TB. */
export function formatStorage(gb: number): string {
  return gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000}TB` : `${gb}GB`;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)}%`;
}

const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  new: 'New',
  'apple-refurbished': 'Apple refurbished',
  'third-party-refurbished': 'Third-party refurbished',
};

export function conditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  const milliseconds =
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(milliseconds / 86_400_000);
}

/** Today's date as YYYY-MM-DD, in UTC. Used at build time only. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
