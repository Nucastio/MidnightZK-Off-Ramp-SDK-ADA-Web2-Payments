import type {
  CardanoLockAnchor,
  Currency,
  MidnightIntentReceipt,
  MidnightSettlementReceipt,
} from "../types.js";
import type {
  ExpectedIntentReceipt,
  ExpectedSettlementReceipt,
} from "./receipt.js";

export interface ProveInputs {
  intentId: string;
  cardanoLockAnchor: CardanoLockAnchor;
  payeeHandle: string;
  payeeSalt: string;
  fiatAmount: string;
  fiatCurrency: Currency;
  railQuoteDigest: string;
  principalLovelace: bigint;
  amountSalt: string;
  payeeCommitment: string;
  amountCommitment: string;
  adapterTag: string;
  complianceMask?: string;
  contractAddress?: string;
  priorReceipt?: MidnightIntentReceipt;
}

export interface SettlementProveInputs {
  intentReceipt: MidnightIntentReceipt;
  settlementDigest: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  verifyDurationMs: number;
}

/**
 * Provider boundary for real Midnight execution and receipt verification.
 * Implementations receive private inputs only for proving; receipts contain
 * finalized public transaction/state evidence and never contain witnesses.
 */
export interface MidnightProofProvider {
  readonly artifactManifestHash: string;
  generateIntentReceipt(inputs: ProveInputs): Promise<MidnightIntentReceipt>;
  verifyIntentReceipt(
    receipt: MidnightIntentReceipt,
    expected: ExpectedIntentReceipt,
  ): Promise<VerifyResult>;
  generateSettlementReceipt(inputs: SettlementProveInputs): Promise<MidnightSettlementReceipt>;
  verifySettlementReceipt(
    receipt: MidnightSettlementReceipt,
    expected: ExpectedSettlementReceipt,
  ): Promise<VerifyResult>;
}

function requireProvider(provider: MidnightProofProvider | undefined): MidnightProofProvider {
  if (!provider) {
    throw new Error("MidnightProofProvider is required; production proof generation and verification fail closed");
  }
  return provider;
}

export async function prove(
  provider: MidnightProofProvider | undefined,
  inputs: ProveInputs,
): Promise<MidnightIntentReceipt> {
  return requireProvider(provider).generateIntentReceipt(inputs);
}

export async function verify(
  provider: MidnightProofProvider | undefined,
  receipt: MidnightIntentReceipt,
  expected: ExpectedIntentReceipt,
): Promise<VerifyResult> {
  return requireProvider(provider).verifyIntentReceipt(receipt, expected);
}

export async function proveSettlement(
  provider: MidnightProofProvider | undefined,
  inputs: SettlementProveInputs,
): Promise<MidnightSettlementReceipt> {
  return requireProvider(provider).generateSettlementReceipt(inputs);
}

export async function verifySettlement(
  provider: MidnightProofProvider | undefined,
  receipt: MidnightSettlementReceipt,
  expected: ExpectedSettlementReceipt,
): Promise<VerifyResult> {
  return requireProvider(provider).verifySettlementReceipt(receipt, expected);
}
