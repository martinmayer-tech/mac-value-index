// Plain constants with no dependencies, so browser code can import them
// without pulling in the schema library. Import as @mvi/contracts/constants.

/** Current schema version, shared by every data file. */
export const SCHEMA_VERSION = 1;

export const CONDITIONS = [
  'new',
  'apple-refurbished',
  'third-party-refurbished',
] as const;

export const FORM_FACTORS = ['desktop', 'laptop'] as const;

export const COLLECTED_BY = ['structured', 'agent', 'manual'] as const;

export const ADAPTER_KINDS = ['structured', 'agent'] as const;

/** The five weighted metrics, in display order. */
export const METRIC_KEYS = [
  'multiCore',
  'memoryHeadroom',
  'gpuAndBandwidth',
  'singleCore',
  'usableStorage',
] as const;
