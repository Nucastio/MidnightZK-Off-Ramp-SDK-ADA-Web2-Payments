import { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { Ledger } from './managed/offramp/contract/index.js';

export type OffRampPrivateState = {
  payeeSecret?: Uint8Array;
  amountSecret?: Uint8Array;
  jurisdictionAttr?: Uint8Array;
};

const ZERO_32 = new Uint8Array(32);

export const offRampWitnesses = {
  payeeSecret: ({
    privateState,
  }: WitnessContext<Ledger, OffRampPrivateState>): [
    OffRampPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    {
      is_some: privateState.payeeSecret !== undefined,
      value: privateState.payeeSecret ?? ZERO_32,
    },
  ],
  amountSecret: ({
    privateState,
  }: WitnessContext<Ledger, OffRampPrivateState>): [
    OffRampPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    {
      is_some: privateState.amountSecret !== undefined,
      value: privateState.amountSecret ?? ZERO_32,
    },
  ],
  jurisdictionAttr: ({
    privateState,
  }: WitnessContext<Ledger, OffRampPrivateState>): [
    OffRampPrivateState,
    { is_some: boolean; value: Uint8Array },
  ] => [
    privateState,
    {
      is_some: privateState.jurisdictionAttr !== undefined,
      value: privateState.jurisdictionAttr ?? ZERO_32,
    },
  ],
};
