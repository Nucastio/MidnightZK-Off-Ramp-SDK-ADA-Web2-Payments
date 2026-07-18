import { createHash } from "node:crypto";
import {
  OFFRAMP_ARTIFACT_MANIFEST,
  OFFRAMP_ARTIFACT_MANIFEST_HASH,
} from "./artifact-manifest.generated.js";
import type {
  CardanoLockAnchor,
  FinalizedMidnightTxIdentifiers,
  MidnightIntentReceipt,
  MidnightPublicState,
  MidnightSettlementReceipt,
} from "../types.js";

const RECEIPT_DOMAIN = "offramp:midnight-receipt:v1";
const PUBLIC_STATE_DOMAIN = "offramp:midnight-public-state:v1";
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const artifactManifest = () => OFFRAMP_ARTIFACT_MANIFEST;
export const artifactManifestHash = () => OFFRAMP_ARTIFACT_MANIFEST_HASH;

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

function domainHash(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(domain, "utf8")
    .update("\n", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function publicStateHash(state: MidnightPublicState): string {
  return domainHash(PUBLIC_STATE_DOMAIN, state);
}

export function receiptHash(receipt: MidnightIntentReceipt | MidnightSettlementReceipt): string {
  const { receiptHash: _ignored, ...payload } = receipt;
  return domainHash(RECEIPT_DOMAIN, payload);
}

export function finalizeIntentReceipt(
  payload: Omit<MidnightIntentReceipt, "publicStateHash" | "receiptHash">,
): MidnightIntentReceipt {
  const receipt = {
    ...payload,
    publicStateHash: publicStateHash(payload.publicState),
    receiptHash: "",
  } satisfies MidnightIntentReceipt;
  return { ...receipt, receiptHash: receiptHash(receipt) };
}

export function finalizeSettlementReceipt(
  payload: Omit<MidnightSettlementReceipt, "publicStateHash" | "receiptHash">,
): MidnightSettlementReceipt {
  const receipt = {
    ...payload,
    publicStateHash: publicStateHash(payload.publicState),
    receiptHash: "",
  } satisfies MidnightSettlementReceipt;
  return { ...receipt, receiptHash: receiptHash(receipt) };
}

export interface ExpectedIntentReceipt {
  intentId: string;
  cardanoLockAnchor: CardanoLockAnchor;
  payeeCommitment: string;
  amountCommitment: string;
  adapterTag: string;
  complianceFlag?: string;
}

export interface ExpectedSettlementReceipt {
  intentId: string;
  intentReceiptHash: string;
  settlementDigest: string;
  contractAddress?: string;
}

export interface ReceiptValidationResult {
  ok: boolean;
  reason?: string;
}

function sameAnchor(a: CardanoLockAnchor, b: CardanoLockAnchor): boolean {
  return a.txHash === b.txHash && a.outputIndex === b.outputIndex;
}

function validateFinalizedTx(
  tx: FinalizedMidnightTxIdentifiers,
  operation: FinalizedMidnightTxIdentifiers["operation"],
  nowMs = Date.now(),
): string | undefined {
  if (tx.operation !== operation) return `${operation} operation mismatch`;
  if (tx.status !== "SucceedEntirely") return `${operation} did not finalize successfully`;
  if (!tx.txId || !tx.txHash || !tx.blockHash || tx.identifiers.length === 0) {
    return `${operation} finalized identifiers are incomplete`;
  }
  if (new Set(tx.identifiers).size !== tx.identifiers.length) {
    return `${operation} finalized identifiers contain duplicates`;
  }
  if (!tx.identifiers.includes(tx.txId)) return `${operation} txId is absent from identifiers`;
  if (!Number.isSafeInteger(tx.blockHeight) || tx.blockHeight < 0) {
    return `${operation} block height is invalid`;
  }
  if (!Number.isSafeInteger(tx.blockTimestamp) || tx.blockTimestamp <= 0) {
    return `${operation} block timestamp is invalid`;
  }
  if (!Number.isSafeInteger(tx.finalizedAtMs) || tx.finalizedAtMs <= 0) {
    return `${operation} finalization timestamp is invalid`;
  }
  const blockTimestampMs = tx.blockTimestamp * 1000;
  if (blockTimestampMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return `${operation} block timestamp is in the future`;
  }
  if (blockTimestampMs > tx.finalizedAtMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return `${operation} finalization predates its block timestamp`;
  }
  return undefined;
}

function validateReceiptTimeline(
  timestamps: { startedAtMs: number; completedAtMs: number },
  transactions: readonly FinalizedMidnightTxIdentifiers[],
): string | undefined {
  const nowMs = Date.now();
  if (!Number.isSafeInteger(timestamps.startedAtMs) || timestamps.startedAtMs <= 0) {
    return "receipt start timestamp is invalid";
  }
  if (!Number.isSafeInteger(timestamps.completedAtMs) || timestamps.completedAtMs <= 0) {
    return "receipt completion timestamp is invalid";
  }
  if (timestamps.startedAtMs > timestamps.completedAtMs) {
    return "receipt timestamps are out of order";
  }
  if (timestamps.completedAtMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return "receipt completion timestamp is in the future";
  }
  for (const tx of transactions) {
    if (tx.finalizedAtMs > timestamps.completedAtMs) {
      return `${tx.operation} finalized after receipt completion`;
    }
  }
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    if (
      current.blockHeight < previous.blockHeight ||
      current.blockTimestamp < previous.blockTimestamp
    ) {
      return `${current.operation} finalized before ${previous.operation}`;
    }
  }
  return undefined;
}

export function validateIntentReceipt(
  receipt: MidnightIntentReceipt,
  expected: ExpectedIntentReceipt,
): ReceiptValidationResult {
  if (
    receipt.kind !== "midnight-intent-receipt" ||
    receipt.version !== 1 ||
    receipt.contractId !== "offramp"
  ) {
    return { ok: false, reason: "unsupported intent receipt" };
  }
  if (!receipt.contractAddress || !receipt.network) {
    return { ok: false, reason: "intent receipt provenance is incomplete" };
  }
  if (receipt.receiptHash !== receiptHash(receipt)) return { ok: false, reason: "receipt hash mismatch" };
  if (receipt.artifactManifestHash !== artifactManifestHash()) {
    return { ok: false, reason: "artifact manifest hash mismatch" };
  }
  if (receipt.publicStateHash !== publicStateHash(receipt.publicState)) {
    return { ok: false, reason: "public state hash mismatch" };
  }
  if (receipt.intentId !== expected.intentId || receipt.publicState.intentId !== expected.intentId) {
    return { ok: false, reason: "intent id mismatch" };
  }
  if (!sameAnchor(receipt.cardanoLockAnchor, expected.cardanoLockAnchor)) {
    return { ok: false, reason: "Cardano lock anchor mismatch" };
  }
  if (receipt.publicState.l1Anchor !== expected.cardanoLockAnchor.txHash) {
    return { ok: false, reason: "ledger anchor mismatch" };
  }
  if (
    receipt.publicInputs.payeeCommitment !== expected.payeeCommitment ||
    receipt.publicState.payeeCommitment !== expected.payeeCommitment
  ) return { ok: false, reason: "payee commitment mismatch" };
  if (
    receipt.publicInputs.amountCommitment !== expected.amountCommitment ||
    receipt.publicState.amountCommitment !== expected.amountCommitment
  ) return { ok: false, reason: "amount commitment mismatch" };
  if (
    receipt.publicInputs.adapterTag !== expected.adapterTag ||
    receipt.publicState.adapterTag !== expected.adapterTag
  ) return { ok: false, reason: "adapter tag mismatch" };
  if (!receipt.publicState.payeeBound || !receipt.publicState.amountBound) {
    return { ok: false, reason: "ordered binding flags are incomplete" };
  }
  if (receipt.publicState.settlementDigest !== "0".repeat(64)) {
    return { ok: false, reason: "intent receipt already contains settlement" };
  }
  if (expected.complianceFlag !== undefined) {
    if (
      receipt.publicInputs.complianceFlag !== expected.complianceFlag ||
      receipt.publicState.complianceFlag !== expected.complianceFlag ||
      !receipt.publicState.complianceProved ||
      !receipt.transactions.proveComplianceFlag
    ) return { ok: false, reason: "compliance proof mismatch" };
  }

  const operations: Array<[FinalizedMidnightTxIdentifiers, FinalizedMidnightTxIdentifiers["operation"]]> = [
    [receipt.transactions.deployment, "deploy"],
    [receipt.transactions.bindOffRampIntent, "bindOffRampIntent"],
    [receipt.transactions.provePayeeBinding, "provePayeeBinding"],
    [receipt.transactions.proveAmountBinding, "proveAmountBinding"],
  ];
  if (receipt.transactions.proveComplianceFlag) {
    operations.push([receipt.transactions.proveComplianceFlag, "proveComplianceFlag"]);
  }
  for (const [tx, operation] of operations) {
    const reason = validateFinalizedTx(tx, operation);
    if (reason) return { ok: false, reason };
  }
  const timelineReason = validateReceiptTimeline(
    receipt.timestamps,
    operations.map(([tx]) => tx),
  );
  return timelineReason ? { ok: false, reason: timelineReason } : { ok: true };
}

export function validateSettlementReceipt(
  receipt: MidnightSettlementReceipt,
  expected: ExpectedSettlementReceipt,
): ReceiptValidationResult {
  if (
    receipt.kind !== "midnight-settlement-receipt" ||
    receipt.version !== 1 ||
    receipt.contractId !== "offramp"
  ) {
    return { ok: false, reason: "unsupported settlement receipt" };
  }
  if (!receipt.contractAddress || !receipt.network) {
    return { ok: false, reason: "settlement receipt provenance is incomplete" };
  }
  if (receipt.receiptHash !== receiptHash(receipt)) return { ok: false, reason: "receipt hash mismatch" };
  if (receipt.artifactManifestHash !== artifactManifestHash()) {
    return { ok: false, reason: "artifact manifest hash mismatch" };
  }
  if (receipt.publicStateHash !== publicStateHash(receipt.publicState)) {
    return { ok: false, reason: "public state hash mismatch" };
  }
  if (receipt.intentId !== expected.intentId || receipt.publicState.intentId !== expected.intentId) {
    return { ok: false, reason: "intent id mismatch" };
  }
  if (receipt.intentReceiptHash !== expected.intentReceiptHash) {
    return { ok: false, reason: "intent receipt hash mismatch" };
  }
  if (receipt.settlementDigest !== expected.settlementDigest || receipt.publicState.settlementDigest !== expected.settlementDigest) {
    return { ok: false, reason: "settlement digest mismatch" };
  }
  if (expected.contractAddress && receipt.contractAddress !== expected.contractAddress) {
    return { ok: false, reason: "contract address mismatch" };
  }
  if (receipt.publicState.l1Anchor !== receipt.cardanoLockAnchor.txHash) {
    return { ok: false, reason: "settlement ledger anchor mismatch" };
  }
  if (!receipt.publicState.payeeBound || !receipt.publicState.amountBound) {
    return { ok: false, reason: "settlement binding flags are incomplete" };
  }
  const reason = validateFinalizedTx(receipt.transaction, "proveOffRampSettlement");
  if (reason) return { ok: false, reason };
  const timelineReason = validateReceiptTimeline(receipt.timestamps, [receipt.transaction]);
  return timelineReason ? { ok: false, reason: timelineReason } : { ok: true };
}
