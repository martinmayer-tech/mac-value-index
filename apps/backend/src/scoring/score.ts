// Capability and value scores, and the ranking order.
//
// Normalisation: every metric is divided by the best (largest) value of
// that metric among the listings being scored, giving zero to one. The
// same function is used for the normal ranking and the sensitivity run.

import type {
  MetricKey,
  Profile,
  ScoreComponent,
  ScoreComponents,
} from '@mvi/contracts';

/** The raw inputs to the score for one listing. */
export interface ScoreInput {
  readonly id: string;
  readonly priceGbp: number;
  readonly multiCore: number;
  readonly singleCore: number;
  readonly metal: number;
  readonly memoryBandwidthGbPerSec: number;
  readonly memoryHeadroomGb: number;
  readonly usableStorageGb: number;
}

export interface Scored {
  readonly id: string;
  readonly priceGbp: number;
  readonly capabilityScore: number;
  readonly valueScore: number;
  readonly components: ScoreComponents;
}

/** Value score: capability score per £1,000. */
export function valueScore(capabilityScore: number, priceGbp: number): number {
  return (capabilityScore / priceGbp) * 1000;
}

/** Divides by the best value; zero when the best value is zero. */
export function normalise(value: number, best: number): number {
  if (best <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / best));
}

function best(values: readonly number[]): number {
  return values.reduce((highest, value) => Math.max(highest, value), 0);
}

function component(
  raw: number,
  normalised: number,
  weight: number,
): ScoreComponent {
  return {raw, normalised, weighted: normalised * weight};
}

/** Scores every input against the best values in the same set. */
export function scoreListings(
  inputs: readonly ScoreInput[],
  profile: Profile,
): readonly Scored[] {
  const bestOf = {
    multiCore: best(inputs.map(input => input.multiCore)),
    singleCore: best(inputs.map(input => input.singleCore)),
    metal: best(inputs.map(input => input.metal)),
    bandwidth: best(inputs.map(input => input.memoryBandwidthGbPerSec)),
    headroom: best(inputs.map(input => input.memoryHeadroomGb)),
    storage: best(inputs.map(input => input.usableStorageGb)),
  };
  const {weights, gpuAndBandwidthSplit: split} = profile;

  return inputs.map(input => {
    const gpuAndBandwidth =
      (split.metal * normalise(input.metal, bestOf.metal) +
        split.memoryBandwidth *
          normalise(input.memoryBandwidthGbPerSec, bestOf.bandwidth)) /
      100;
    const components: ScoreComponents = {
      multiCore: component(
        input.multiCore,
        normalise(input.multiCore, bestOf.multiCore),
        weights.multiCore,
      ),
      memoryHeadroom: component(
        input.memoryHeadroomGb,
        normalise(input.memoryHeadroomGb, bestOf.headroom),
        weights.memoryHeadroom,
      ),
      gpuAndBandwidth: component(
        gpuAndBandwidth,
        gpuAndBandwidth,
        weights.gpuAndBandwidth,
      ),
      singleCore: component(
        input.singleCore,
        normalise(input.singleCore, bestOf.singleCore),
        weights.singleCore,
      ),
      usableStorage: component(
        input.usableStorageGb,
        normalise(input.usableStorageGb, bestOf.storage),
        weights.usableStorage,
      ),
    };
    const keys: readonly MetricKey[] = [
      'multiCore',
      'memoryHeadroom',
      'gpuAndBandwidth',
      'singleCore',
      'usableStorage',
    ];
    const capabilityScore = Math.min(
      100,
      keys.reduce((sum, key) => sum + components[key].weighted, 0),
    );
    return {
      id: input.id,
      priceGbp: input.priceGbp,
      capabilityScore,
      valueScore: valueScore(capabilityScore, input.priceGbp),
      components,
    };
  });
}

/**
 * Ranking order: higher value score first; ties break on higher capability
 * score, then lower price, then listing id.
 */
export function compareScored(a: Scored, b: Scored): number {
  if (a.valueScore !== b.valueScore) {
    return b.valueScore - a.valueScore;
  }
  if (a.capabilityScore !== b.capabilityScore) {
    return b.capabilityScore - a.capabilityScore;
  }
  if (a.priceGbp !== b.priceGbp) {
    return a.priceGbp - b.priceGbp;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Returns the scored listings in ranking order. */
export function rank(scored: readonly Scored[]): readonly Scored[] {
  return [...scored].sort(compareScored);
}

/**
 * Ids on the Pareto frontier of price against capability: no other listing
 * is at least as cheap and at least as capable, and better on one of them.
 */
export function paretoFrontier(scored: readonly Scored[]): readonly string[] {
  return scored
    .filter(
      candidate =>
        !scored.some(
          other =>
            other.priceGbp <= candidate.priceGbp &&
            other.capabilityScore >= candidate.capabilityScore &&
            (other.priceGbp < candidate.priceGbp ||
              other.capabilityScore > candidate.capabilityScore),
        ),
    )
    .map(candidate => candidate.id);
}
