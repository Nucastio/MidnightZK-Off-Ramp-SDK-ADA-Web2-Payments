/**
 * Midnight.js wiring: `CompiledContract` + ZK artifact paths for `offramp.compact`.
 *
 * Constructor args match the order in `offramp.compact`:
 *   `[intent, payee, amount, adapter]` — all `Bytes<32>`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import * as OffRamp from './managed/offramp/contract/index.js';
import { offRampWitnesses } from './witnesses-offramp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const offRampZkConfigPath = path.resolve(__dirname, 'managed', 'offramp');

export const offRampCompiledContract = CompiledContract.make(
  'offramp',
  OffRamp.Contract,
).pipe(
  CompiledContract.withWitnesses(offRampWitnesses),
  CompiledContract.withCompiledFileAssets(offRampZkConfigPath),
);

export const offRampPrivateStateId = 'offRampPrivateState' as const;

export type OffRampConstructorArgs = readonly [
  intent: Uint8Array,
  payee: Uint8Array,
  amount: Uint8Array,
  adapter: Uint8Array,
];
