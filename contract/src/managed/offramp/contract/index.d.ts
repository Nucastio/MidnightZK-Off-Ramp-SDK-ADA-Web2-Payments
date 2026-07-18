import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  payeeSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                            value: Uint8Array
                                                                          }];
  amountSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                             value: Uint8Array
                                                                           }];
  jurisdictionAttr(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { is_some: boolean,
                                                                                 value: Uint8Array
                                                                               }];
}

export type ImpureCircuits<PS> = {
  bindOffRampIntent(context: __compactRuntime.CircuitContext<PS>,
                    anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  provePayeeBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveAmountBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveComplianceFlag(context: __compactRuntime.CircuitContext<PS>,
                      allowedMask_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveOffRampSettlement(context: __compactRuntime.CircuitContext<PS>,
                         digest_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type ProvableCircuits<PS> = {
  bindOffRampIntent(context: __compactRuntime.CircuitContext<PS>,
                    anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  provePayeeBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveAmountBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveComplianceFlag(context: __compactRuntime.CircuitContext<PS>,
                      allowedMask_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveOffRampSettlement(context: __compactRuntime.CircuitContext<PS>,
                         digest_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  bindOffRampIntent(context: __compactRuntime.CircuitContext<PS>,
                    anchor_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  provePayeeBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveAmountBinding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, boolean>;
  proveComplianceFlag(context: __compactRuntime.CircuitContext<PS>,
                      allowedMask_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveOffRampSettlement(context: __compactRuntime.CircuitContext<PS>,
                         digest_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type Ledger = {
  readonly intentId: Uint8Array;
  readonly payeeCommitment: Uint8Array;
  readonly amountCommitment: Uint8Array;
  readonly adapterTag: Uint8Array;
  readonly l1Anchor: Uint8Array;
  readonly complianceFlag: Uint8Array;
  readonly settlementDigest: Uint8Array;
  readonly payeeBound: boolean;
  readonly amountBound: boolean;
  readonly complianceProved: boolean;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               intent_0: Uint8Array,
               payee_0: Uint8Array,
               amount_0: Uint8Array,
               adapter_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
