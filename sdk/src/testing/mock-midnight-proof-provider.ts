import { createHash } from "node:crypto";
import { amountCommitment, payeeCommitment } from "../commitments.js";
import type {
  FinalizedMidnightTxIdentifiers,
  MidnightIntentReceipt,
  MidnightPublicState,
  MidnightSettlementReceipt,
} from "../types.js";
import type {
  MidnightProofProvider,
  ProveInputs,
  SettlementProveInputs,
  VerifyResult,
} from "../midnight/prove.js";
import {
  artifactManifestHash,
  finalizeIntentReceipt,
  finalizeSettlementReceipt,
  validateIntentReceipt,
  validateSettlementReceipt,
  type ExpectedIntentReceipt,
  type ExpectedSettlementReceipt,
} from "../midnight/receipt.js";

function digest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

function fakeTx(
  operation: FinalizedMidnightTxIdentifiers["operation"],
  intentId: string,
  height: number,
  finalizedAtMs: number,
): FinalizedMidnightTxIdentifiers {
  const txId = digest("mock-midnight-tx", operation, intentId);
  return {
    operation,
    status: "SucceedEntirely",
    txId,
    identifiers: [txId],
    txHash: digest("mock-midnight-hash", operation, intentId),
    blockHash: digest("mock-midnight-block", String(height)),
    blockHeight: height,
    blockTimestamp: Math.floor(finalizedAtMs / 1000),
    finalizedAtMs,
  };
}

/** Explicit test-only provider. It is not exported from the production SDK root. */
export class MockMidnightProofProvider implements MidnightProofProvider {
  readonly artifactManifestHash = artifactManifestHash();

  async generateIntentReceipt(inputs: ProveInputs): Promise<MidnightIntentReceipt> {
    const startedAtMs = Date.now();
    const payee = payeeCommitment(inputs.payeeHandle, inputs.payeeSalt);
    const amount = amountCommitment({
      fiatAmount: inputs.fiatAmount,
      fiatCurrency: inputs.fiatCurrency,
      railQuoteDigest: inputs.railQuoteDigest,
      principalLovelace: inputs.principalLovelace,
      salt: inputs.amountSalt,
    });
    if (payee.commitment !== inputs.payeeCommitment) throw new Error("payee commitment mismatch");
    if (amount.commitment !== inputs.amountCommitment) throw new Error("amount commitment mismatch");
    const completedAtMs = Date.now();
    const contractAddress = inputs.contractAddress ?? `mock_${digest("contract", inputs.intentId)}`;
    const zero = "0".repeat(64);
    const publicState: MidnightPublicState = {
      intentId: inputs.intentId,
      payeeCommitment: payee.commitment,
      amountCommitment: amount.commitment,
      adapterTag: inputs.adapterTag,
      l1Anchor: inputs.cardanoLockAnchor.txHash,
      complianceFlag: inputs.complianceMask ?? zero,
      settlementDigest: zero,
      payeeBound: true,
      amountBound: true,
      complianceProved: inputs.complianceMask !== undefined,
    };
    return finalizeIntentReceipt({
      kind: "midnight-intent-receipt",
      version: 1,
      contractId: "offramp",
      intentId: inputs.intentId,
      cardanoLockAnchor: inputs.cardanoLockAnchor,
      contractAddress,
      network: "mock-test",
      artifactManifestHash: this.artifactManifestHash,
      publicInputs: {
        payeeCommitment: payee.commitment,
        amountCommitment: amount.commitment,
        adapterTag: inputs.adapterTag,
        complianceFlag: inputs.complianceMask,
      },
      transactions: {
        deployment: fakeTx("deploy", inputs.intentId, 1, completedAtMs),
        bindOffRampIntent: fakeTx("bindOffRampIntent", inputs.intentId, 2, completedAtMs),
        provePayeeBinding: fakeTx("provePayeeBinding", inputs.intentId, 3, completedAtMs),
        proveAmountBinding: fakeTx("proveAmountBinding", inputs.intentId, 4, completedAtMs),
        proveComplianceFlag: inputs.complianceMask === undefined
          ? undefined
          : fakeTx("proveComplianceFlag", inputs.intentId, 5, completedAtMs),
      },
      publicState,
      timestamps: { startedAtMs, completedAtMs },
    });
  }

  async verifyIntentReceipt(
    receipt: MidnightIntentReceipt,
    expected: ExpectedIntentReceipt,
  ): Promise<VerifyResult> {
    const startedAt = performance.now();
    const result = validateIntentReceipt(receipt, expected);
    return { ...result, verifyDurationMs: Math.round(performance.now() - startedAt) };
  }

  async generateSettlementReceipt(inputs: SettlementProveInputs): Promise<MidnightSettlementReceipt> {
    const startedAtMs = Date.now();
    const completedAtMs = Date.now();
    const publicState = {
      ...inputs.intentReceipt.publicState,
      settlementDigest: inputs.settlementDigest,
    };
    return finalizeSettlementReceipt({
      kind: "midnight-settlement-receipt",
      version: 1,
      contractId: "offramp",
      intentId: inputs.intentReceipt.intentId,
      intentReceiptHash: inputs.intentReceipt.receiptHash,
      cardanoLockAnchor: inputs.intentReceipt.cardanoLockAnchor,
      contractAddress: inputs.intentReceipt.contractAddress,
      network: inputs.intentReceipt.network,
      artifactManifestHash: this.artifactManifestHash,
      settlementDigest: inputs.settlementDigest,
      transaction: fakeTx("proveOffRampSettlement", inputs.intentReceipt.intentId, 6, completedAtMs),
      publicState,
      timestamps: { startedAtMs, completedAtMs },
    });
  }

  async verifySettlementReceipt(
    receipt: MidnightSettlementReceipt,
    expected: ExpectedSettlementReceipt,
  ): Promise<VerifyResult> {
    const startedAt = performance.now();
    const result = validateSettlementReceipt(receipt, expected);
    return { ...result, verifyDurationMs: Math.round(performance.now() - startedAt) };
  }
}
