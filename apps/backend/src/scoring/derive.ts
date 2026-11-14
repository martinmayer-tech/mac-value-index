// Derived metrics for one listing. Pure functions of the listing, its chip
// and the profile: adding or removing other listings never changes them.

import type {DerivedMetrics, Profile} from '@mvi/contracts';

export interface DeriveInput {
  readonly ramGb: number;
  readonly ssdGb: number;
  readonly priceGbp: number;
  readonly multiCore: number;
}

/** RAM left for models after the reservation, never below zero. */
export function memoryHeadroomGb(ramGb: number, profile: Profile): number {
  return Math.max(0, ramGb - profile.reservations.memoryGb);
}

/** SSD left after the baseline reservation, never below zero. */
export function usableStorageGb(ssdGb: number, profile: Profile): number {
  return Math.max(0, ssdGb - profile.reservations.storageGb);
}

/** Largest model class whose threshold the headroom meets. */
export function modelClassFor(headroomGb: number, profile: Profile): string {
  let label = profile.belowSmallestClassLabel;
  for (const modelClass of profile.modelClasses) {
    if (headroomGb >= modelClass.minHeadroomGb) {
      label = modelClass.label;
    }
  }
  return label;
}

export function deriveMetrics(
  input: DeriveInput,
  profile: Profile,
): DerivedMetrics {
  const headroom = memoryHeadroomGb(input.ramGb, profile);
  const usable = usableStorageGb(input.ssdGb, profile);
  return {
    memoryHeadroomGb: headroom,
    modelClass: modelClassFor(headroom, profile),
    usableStorageGb: usable,
    gbpPer1000MultiCore: (input.priceGbp / input.multiCore) * 1000,
    gbpPerGbRam: input.priceGbp / input.ramGb,
    gbpPerGbUsableStorage: usable > 0 ? input.priceGbp / usable : null,
  };
}
