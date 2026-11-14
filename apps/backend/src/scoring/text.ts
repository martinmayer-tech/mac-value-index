// Plain-English text built from calculated figures only.

import type {Condition} from '@mvi/contracts';

/** Groups the digits of a non-negative whole number in threes. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats a number with thousands separators and fixed decimals. */
export function formatNumber(value: number, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole = '0', fraction] = fixed.split('.');
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : '';
  const grouped = groupThousands(whole);
  return fraction === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fraction}`;
}

/** Formats GBP: whole pounds without pence, otherwise two decimals. */
export function formatGbp(amount: number): string {
  const pence = Math.round(amount * 100);
  const decimals = pence % 100 === 0 ? 0 : 2;
  const text = formatNumber(Math.abs(pence) / 100, decimals);
  return pence < 0 ? `-£${text}` : `£${text}`;
}

/** Formats storage as marketed: 512GB, 1TB, 2TB. */
export function formatStorage(gb: number): string {
  if (gb >= 1000 && gb % 1000 === 0) {
    return `${gb / 1000}TB`;
  }
  return `${gb}GB`;
}

const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  new: 'new',
  'apple-refurbished': 'Apple refurbished',
  'third-party-refurbished': 'third-party refurbished',
};

export function conditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

export interface NameParts {
  readonly model: string;
  readonly chipFamily: string;
  readonly cpuCores: number;
  readonly gpuCores: number;
  readonly ramGb: number;
  readonly ssdGb: number;
}

/**
 * Short configuration name, for example
 * "Mac mini M4 Pro 12/16-core 48GB 1TB". The core pair is CPU/GPU and is
 * needed because one chip family ships in several variants.
 */
export function configurationName(parts: NameParts): string {
  return `${parts.model} ${parts.chipFamily} ${parts.cpuCores}/${parts.gpuCores}-core ${parts.ramGb}GB ${formatStorage(parts.ssdGb)}`;
}

/** Chip label, for example "M4 Pro (12-core CPU, 16-core GPU)". */
export function chipLabel(
  family: string,
  cpuCores: number,
  gpuCores: number,
): string {
  return `${family} (${cpuCores}-core CPU, ${gpuCores}-core GPU)`;
}

export interface SummaryParts extends NameParts {
  readonly condition: Condition;
  readonly priceGbp: number;
  readonly multiCore: number;
  readonly modelClass: string;
  readonly fitsSmallestClass: boolean;
  readonly usableStorageGb: number;
}

function modelPhrase(parts: SummaryParts): string {
  return parts.fitsSmallestClass
    ? `runs models up to ${parts.modelClass}`
    : `runs only models ${parts.modelClass}`;
}

/** One plain-English line per ranked listing. */
export function summaryLine(parts: SummaryParts): string {
  return `${configurationName(parts)} (${conditionLabel(parts.condition)}) is ${formatGbp(parts.priceGbp)}, scores ${formatNumber(parts.multiCore)} multi-core, ${modelPhrase(parts)}, and stores ${formatNumber(parts.usableStorageGb)} GB usable.`;
}

export interface ConclusionParts extends SummaryParts {
  readonly seller: string;
  readonly profileName: string;
  readonly capabilityScore: number;
  readonly valueScore: number;
  readonly isStable: boolean;
  readonly profileCount: number;
  readonly runnerUp: {readonly name: string; readonly priceGbp: number} | null;
}

/** The conclusion: three sentences or fewer. */
export function conclusionText(parts: ConclusionParts): string {
  const sentences = [
    `${configurationName(parts)} (${conditionLabel(parts.condition)}) at ${formatGbp(parts.priceGbp)} from ${parts.seller} is the best value for the "${parts.profileName}" profile, with a value score of ${formatNumber(parts.valueScore, 2)} and a capability score of ${formatNumber(parts.capabilityScore, 1)} out of 100.`,
    `It scores ${formatNumber(parts.multiCore)} multi-core, ${modelPhrase(parts)} and keeps ${formatNumber(parts.usableStorageGb)} GB of usable storage.`,
  ];
  if (parts.isStable && parts.profileCount > 1) {
    sentences.push(
      `It is in the top 10 under all ${parts.profileCount} profiles.`,
    );
  } else if (parts.runnerUp !== null) {
    sentences.push(
      `The runner-up is ${parts.runnerUp.name} at ${formatGbp(parts.runnerUp.priceGbp)}.`,
    );
  }
  return sentences.join(' ');
}

export const NO_LISTINGS_CONCLUSION =
  'No listing met the floors for this profile, so there is no recommendation.';
