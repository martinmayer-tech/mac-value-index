import type {SourceAdapter} from '../types.js';

import {appleUkNew} from './apple-uk-new.js';
import {appleUkRefurbished} from './apple-uk-refurbished.js';

/**
 * Every source adapter, in run order. To add a source, write an adapter
 * file in this directory and add it here. See the README.
 */
export const ADAPTERS: readonly SourceAdapter[] = [
  appleUkNew,
  appleUkRefurbished,
];
