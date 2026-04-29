/**
 * Must use the same `@midnight-ntwrk/compact-js` instance as `@midnight-ntwrk/midnight-js-contracts`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { OffRamp, offRampWitnesses } from '@offramp/midnight-contract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const offRampCompiledContractLocal = CompiledContract.make(
  'offramp',
  OffRamp.Contract,
).pipe(
  CompiledContract.withWitnesses(offRampWitnesses),
  CompiledContract.withCompiledFileAssets(
    path.resolve(__dirname, '../../contract/src/managed/offramp'),
  ),
);
