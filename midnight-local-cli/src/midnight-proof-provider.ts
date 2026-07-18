import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import * as bip39 from "bip39";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import {
  OffRamp,
  offRampCompiledContract,
  offRampPrivateStateId,
  type OffRampPrivateState,
} from "@offramp/midnight-contract";
import {
  amountCommitment,
  artifactManifest,
  artifactManifestHash,
  finalizeIntentReceipt,
  finalizeSettlementReceipt,
  payeeCommitment,
  publicStateHash,
  validateIntentReceipt,
  validateSettlementReceipt,
  type ExpectedIntentReceipt,
  type ExpectedSettlementReceipt,
  type FinalizedMidnightTxIdentifiers,
  type MidnightIntentReceipt,
  type MidnightProofProvider,
  type MidnightPublicState,
  type MidnightSettlementReceipt,
  type ProveInputs,
  type SettlementProveInputs,
  type VerifyResult,
} from "@nucast/midnightzk-offramp-sdk";
import { OffRampMidnightConfig } from "./config.js";
import { ensureDustReady } from "./dust.js";
import { configureOffRampProviders } from "./providers.js";
import { initWalletWithSeed, type WalletContext } from "./wallet.js";

if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

const ZERO_32 = "0".repeat(64);
type OffRampProviders = Awaited<ReturnType<typeof configureOffRampProviders>>;

export function validateOffRampArtifactDirectory(artifactsDir: string): string {
  const resolvedDir = path.resolve(artifactsDir);
  const runtimeArtifacts = artifactManifest().artifacts.filter(
    (artifact) => "runtimePath" in artifact,
  );
  if (runtimeArtifacts.length === 0) {
    throw new Error("Packaged Midnight artifact manifest has no runtime artifacts");
  }
  for (const artifact of runtimeArtifacts) {
    if (!("runtimePath" in artifact)) continue;
    const artifactPath = path.resolve(resolvedDir, artifact.runtimePath);
    if (!artifactPath.startsWith(`${resolvedDir}${path.sep}`)) {
      throw new Error(`Midnight artifact path escapes configured directory: ${artifact.runtimePath}`);
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(artifactPath);
    } catch {
      throw new Error(`Missing configured Midnight artifact: ${artifactPath}`);
    }
    if (bytes.length !== artifact.size) {
      throw new Error(`Configured Midnight artifact size mismatch: ${artifactPath}`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== artifact.sha256) {
      throw new Error(`Configured Midnight artifact hash mismatch: ${artifactPath}`);
    }
  }
  return artifactManifestHash();
}

function normalizeHex32(label: string, value: string): string {
  const normalized = value.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a 32-byte hex string`);
  return normalized;
}

function bytes32(label: string, value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(normalizeHex32(label, value), "hex"));
}

function bytesHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

/**
 * Normalize a block timestamp to seconds. The local indexer v4 (and
 * midnight-js `FinalizedTxData` backed by it) reports block timestamps in
 * milliseconds; the canonical receipt format stores seconds. Values that are
 * unambiguously milliseconds (past the year 5000 when read as seconds) are
 * floor-divided by 1000.
 */
function blockTimestampSeconds(value: number): number {
  return value > 100_000_000_000 ? Math.floor(value / 1000) : value;
}

function finalizedTx(
  operation: FinalizedMidnightTxIdentifiers["operation"],
  tx: FinalizedTxData,
): FinalizedMidnightTxIdentifiers {
  if (tx.status !== "SucceedEntirely") {
    throw new Error(`${operation} finalized with status ${tx.status}`);
  }
  return {
    operation,
    status: "SucceedEntirely",
    txId: String(tx.txId).toLowerCase(),
    identifiers: tx.identifiers.map((id) => String(id).toLowerCase()),
    txHash: String(tx.txHash).toLowerCase(),
    blockHash: String(tx.blockHash).toLowerCase(),
    blockHeight: tx.blockHeight,
    blockTimestamp: blockTimestampSeconds(tx.blockTimestamp),
    finalizedAtMs: Date.now(),
  };
}

function decodePublicState(data: Parameters<typeof OffRamp.ledger>[0]): MidnightPublicState {
  const ledger = OffRamp.ledger(data);
  return {
    intentId: bytesHex(ledger.intentId),
    payeeCommitment: bytesHex(ledger.payeeCommitment),
    amountCommitment: bytesHex(ledger.amountCommitment),
    adapterTag: bytesHex(ledger.adapterTag),
    l1Anchor: bytesHex(ledger.l1Anchor),
    complianceFlag: bytesHex(ledger.complianceFlag),
    settlementDigest: bytesHex(ledger.settlementDigest),
    payeeBound: ledger.payeeBound,
    amountBound: ledger.amountBound,
    complianceProved: ledger.complianceProved,
  };
}

async function readPublicState(
  providers: OffRampProviders,
  contractAddress: string,
  blockHeight?: number,
): Promise<MidnightPublicState> {
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress,
    blockHeight === undefined ? undefined : { type: "blockHeight", blockHeight },
  );
  if (!state) throw new Error(`Midnight contract state not found: ${contractAddress}`);
  return decodePublicState(state.data);
}

function privateStateFor(inputs: ProveInputs): OffRampPrivateState {
  const payee = payeeCommitment(inputs.payeeHandle, inputs.payeeSalt);
  const amount = amountCommitment({
    fiatAmount: inputs.fiatAmount,
    fiatCurrency: inputs.fiatCurrency,
    railQuoteDigest: inputs.railQuoteDigest,
    principalLovelace: inputs.principalLovelace,
    salt: inputs.amountSalt,
  });
  return {
    payeeSecret: bytes32("payee secret", payee.secret),
    amountSecret: bytes32("amount secret", amount.secret),
    jurisdictionAttr: inputs.complianceMask === undefined
      ? undefined
      : bytes32("compliance mask", inputs.complianceMask),
  };
}

interface IndexerTxMetadata {
  hash: string;
  identifiers: string[];
  block: { height: number; hash: string; timestamp: number };
  transactionResult: { status: "FAILURE" | "PARTIAL_SUCCESS" | "SUCCESS" };
}

const TX_METADATA_QUERY = `
  query TX_ID_QUERY($offset: TransactionOffset!) {
    transactions(offset: $offset) {
      hash
      block { height hash timestamp }
      ... on RegularTransaction {
        identifiers
        transactionResult { status }
      }
    }
  }
`;

function verificationTimeoutMs(): number {
  const value = Number(process.env.MIDNIGHT_VERIFY_TX_MS ?? "60000");
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("MIDNIGHT_VERIFY_TX_MS must be a positive integer");
  }
  return value;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function queryTxMetadata(
  indexerUrl: string,
  txId: string,
  signal: AbortSignal,
): Promise<IndexerTxMetadata | undefined> {
  const response = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: TX_METADATA_QUERY, variables: { offset: { identifier: txId } } }),
    signal,
  });
  if (!response.ok) throw new Error(`Midnight indexer returned HTTP ${response.status}`);
  const body = await response.json() as {
    data?: { transactions?: IndexerTxMetadata[] };
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`Midnight indexer query failed: ${body.errors.map((error) => error.message ?? "unknown error").join("; ")}`);
  }
  return body.data?.transactions?.[0];
}

export async function verifyFinalizedTx(
  indexerUrl: string,
  expected: FinalizedMidnightTxIdentifiers,
): Promise<string | undefined> {
  const timeoutMs = verificationTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let actual: IndexerTxMetadata | undefined;
    while (!actual) {
      actual = await queryTxMetadata(indexerUrl, expected.txId, controller.signal);
      if (!actual) await abortableDelay(1_000, controller.signal);
    }
    if (actual.transactionResult.status !== "SUCCESS") return `${expected.operation} is not finalized successfully`;
    if (String(actual.hash).toLowerCase() !== expected.txHash) return `${expected.operation} tx hash mismatch`;
    if (String(actual.block.hash).toLowerCase() !== expected.blockHash) return `${expected.operation} block hash mismatch`;
    if (actual.block.height !== expected.blockHeight) return `${expected.operation} block height mismatch`;
    if (blockTimestampSeconds(actual.block.timestamp) !== expected.blockTimestamp) {
      return `${expected.operation} block timestamp mismatch`;
    }
    const identifiers = actual.identifiers.map((id) => String(id).toLowerCase()).sort();
    const expectedIdentifiers = [...expected.identifiers].sort();
    if (
      identifiers.length !== expectedIdentifiers.length ||
      identifiers.some((id, index) => id !== expectedIdentifiers[index])
    ) {
      return `${expected.operation} identifier mismatch`;
    }
    return undefined;
  } catch (error) {
    if (controller.signal.aborted) {
      return `${expected.operation} was not found in the Midnight indexer within ${timeoutMs}ms`;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class MidnightLocalProofProvider implements MidnightProofProvider {
  readonly artifactManifestHash: string;
  private runtimePromise?: Promise<{ providers: OffRampProviders; wallet: WalletContext }>;
  private submissionTail: Promise<void> = Promise.resolve();

  constructor(
    readonly config: OffRampMidnightConfig,
    private readonly mnemonic: string,
  ) {
    this.artifactManifestHash = validateOffRampArtifactDirectory(config.offRampArtifactsDir);
  }

  private async runtime(): Promise<{ providers: OffRampProviders; wallet: WalletContext }> {
    if (!this.runtimePromise) {
      this.runtimePromise = (async () => {
        if (!bip39.validateMnemonic(this.mnemonic)) {
          throw new Error("BIP39_MNEMONIC is missing or invalid for the Midnight proof provider");
        }
        const seed = Buffer.from(await bip39.mnemonicToSeed(this.mnemonic));
        const wallet = await initWalletWithSeed(seed, this.config);
        return { providers: await configureOffRampProviders(wallet, this.config), wallet };
      })();
    }
    const pending = this.runtimePromise;
    try {
      return await pending;
    } catch (error) {
      if (this.runtimePromise === pending) this.runtimePromise = undefined;
      throw error;
    }
  }

  private async withSubmissionLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.submissionTail;
    let release!: () => void;
    this.submissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  }

  private async prepareForSubmission(): Promise<OffRampProviders> {
    const { providers, wallet } = await this.runtime();
    await ensureDustReady(wallet, { timeoutMs: 240_000 });
    return providers;
  }

  async generateIntentReceipt(inputs: ProveInputs): Promise<MidnightIntentReceipt> {
    return this.withSubmissionLock(() => this.generateIntentReceiptUnlocked(inputs));
  }

  private async generateIntentReceiptUnlocked(inputs: ProveInputs): Promise<MidnightIntentReceipt> {
    const startedAtMs = Date.now();
    const normalizedIntent = normalizeHex32("intentId", inputs.intentId);
    const lockTxHash = normalizeHex32("Cardano lock tx hash", inputs.cardanoLockAnchor.txHash);
    const payee = payeeCommitment(inputs.payeeHandle, inputs.payeeSalt);
    const amount = amountCommitment({
      fiatAmount: inputs.fiatAmount,
      fiatCurrency: inputs.fiatCurrency,
      railQuoteDigest: inputs.railQuoteDigest,
      principalLovelace: inputs.principalLovelace,
      salt: inputs.amountSalt,
    });
    const expectedPayee = normalizeHex32("payee commitment", inputs.payeeCommitment);
    const expectedAmount = normalizeHex32("amount commitment", inputs.amountCommitment);
    if (payee.commitment !== expectedPayee) throw new Error("Payee witness does not match the stored commitment");
    if (amount.commitment !== expectedAmount) throw new Error("Amount witness does not match the stored commitment");
    if (inputs.priorReceipt) {
      const priorValidation = validateIntentReceipt(inputs.priorReceipt, {
        intentId: normalizedIntent,
        cardanoLockAnchor: { txHash: lockTxHash, outputIndex: inputs.cardanoLockAnchor.outputIndex },
        payeeCommitment: expectedPayee,
        amountCommitment: expectedAmount,
        adapterTag: normalizeHex32("adapter tag", inputs.adapterTag),
        complianceFlag: inputs.complianceMask === undefined
          ? undefined
          : normalizeHex32("compliance mask", inputs.complianceMask),
      });
      if (!priorValidation.ok) throw new Error(`Invalid prior Midnight receipt: ${priorValidation.reason}`);
      if (inputs.priorReceipt.network !== this.config.networkId) {
        throw new Error("Prior Midnight receipt network mismatch");
      }
    }
    const privateState = privateStateFor(inputs);
    const providers = await this.prepareForSubmission();

    const contract = inputs.contractAddress
      ? await findDeployedContract(providers, {
        compiledContract: offRampCompiledContract,
        contractAddress: inputs.contractAddress,
        privateStateId: offRampPrivateStateId,
        initialPrivateState: privateState,
      })
      : await deployContract(providers, {
        compiledContract: offRampCompiledContract,
        privateStateId: offRampPrivateStateId,
        initialPrivateState: privateState,
        args: [
          bytes32("intentId", normalizedIntent),
          bytes32("payee commitment", expectedPayee),
          bytes32("amount commitment", expectedAmount),
          bytes32("adapter tag", inputs.adapterTag),
        ],
      });

    const contractAddress = String(contract.deployTxData.public.contractAddress);
    const prior = inputs.priorReceipt;
    if (prior && prior.contractAddress !== contractAddress) {
      throw new Error("Prior Midnight receipt contract address mismatch");
    }

    let state = await readPublicState(providers, contractAddress);
    let bindTx = prior?.transactions.bindOffRampIntent;
    if (state.l1Anchor === ZERO_32) {
      bindTx = finalizedTx("bindOffRampIntent", (await contract.callTx.bindOffRampIntent(bytes32("Cardano lock anchor", lockTxHash))).public);
      state = await readPublicState(providers, contractAddress);
    } else if (state.l1Anchor !== lockTxHash) {
      throw new Error("Existing Midnight contract is bound to a different Cardano lock anchor");
    } else if (!bindTx) {
      throw new Error("Existing anchor has no prior finalized bind transaction receipt");
    }

    let payeeTx = prior?.transactions.provePayeeBinding;
    if (!state.payeeBound) {
      payeeTx = finalizedTx("provePayeeBinding", (await contract.callTx.provePayeeBinding()).public);
      state = await readPublicState(providers, contractAddress);
    } else if (!payeeTx) {
      throw new Error("Existing payee proof has no prior finalized transaction receipt");
    }

    let amountTx = prior?.transactions.proveAmountBinding;
    if (!state.amountBound) {
      amountTx = finalizedTx("proveAmountBinding", (await contract.callTx.proveAmountBinding()).public);
      state = await readPublicState(providers, contractAddress);
    } else if (!amountTx) {
      throw new Error("Existing amount proof has no prior finalized transaction receipt");
    }

    let complianceTx = prior?.transactions.proveComplianceFlag;
    if (inputs.complianceMask !== undefined) {
      const complianceMask = normalizeHex32("compliance mask", inputs.complianceMask);
      if (!state.complianceProved) {
        complianceTx = finalizedTx(
          "proveComplianceFlag",
          (await contract.callTx.proveComplianceFlag(bytes32("compliance mask", complianceMask))).public,
        );
        state = await readPublicState(providers, contractAddress);
      } else if (state.complianceFlag !== complianceMask) {
        throw new Error("Existing Midnight compliance flag does not match requested mask");
      } else if (!complianceTx) {
        throw new Error("Existing compliance proof has no prior finalized transaction receipt");
      }
    }

    state = await readPublicState(providers, contractAddress);
    if (state.intentId !== normalizedIntent || state.payeeCommitment !== expectedPayee || state.amountCommitment !== expectedAmount) {
      throw new Error("Final Midnight ledger state does not match the requested intent commitments");
    }
    if (!bindTx || !payeeTx || !amountTx) throw new Error("Midnight intent transaction receipts are incomplete");

    return finalizeIntentReceipt({
      kind: "midnight-intent-receipt",
      version: 1,
      contractId: "offramp",
      intentId: normalizedIntent,
      cardanoLockAnchor: { txHash: lockTxHash, outputIndex: inputs.cardanoLockAnchor.outputIndex },
      contractAddress,
      network: this.config.networkId,
      artifactManifestHash: this.artifactManifestHash,
      publicInputs: {
        payeeCommitment: expectedPayee,
        amountCommitment: expectedAmount,
        adapterTag: normalizeHex32("adapter tag", inputs.adapterTag),
        complianceFlag: inputs.complianceMask === undefined
          ? undefined
          : normalizeHex32("compliance mask", inputs.complianceMask),
      },
      transactions: {
        deployment: finalizedTx("deploy", contract.deployTxData.public),
        bindOffRampIntent: bindTx,
        provePayeeBinding: payeeTx,
        proveAmountBinding: amountTx,
        proveComplianceFlag: complianceTx,
      },
      publicState: state,
      timestamps: { startedAtMs, completedAtMs: Date.now() },
    });
  }

  async verifyIntentReceipt(
    receipt: MidnightIntentReceipt,
    expected: ExpectedIntentReceipt,
  ): Promise<VerifyResult> {
    const startedAt = performance.now();
    const canonical = validateIntentReceipt(receipt, expected);
    if (!canonical.ok) return { ...canonical, verifyDurationMs: Math.round(performance.now() - startedAt) };
    if (receipt.network !== this.config.networkId) {
      return { ok: false, reason: "Midnight network mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
    }
    try {
      const { providers } = await this.runtime();
      const txs = [
        receipt.transactions.deployment,
        receipt.transactions.bindOffRampIntent,
        receipt.transactions.provePayeeBinding,
        receipt.transactions.proveAmountBinding,
        receipt.transactions.proveComplianceFlag,
      ].filter((tx): tx is FinalizedMidnightTxIdentifiers => tx !== undefined);
      for (const tx of txs) {
        const reason = await verifyFinalizedTx(this.config.indexer, tx);
        if (reason) return { ok: false, reason, verifyDurationMs: Math.round(performance.now() - startedAt) };
      }
      const finalTx = receipt.transactions.proveComplianceFlag ?? receipt.transactions.proveAmountBinding;
      const state = await readPublicState(providers, receipt.contractAddress, finalTx.blockHeight);
      if (publicStateHash(state) !== receipt.publicStateHash) {
        return { ok: false, reason: "Finalized Midnight ledger state mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
      }
      return { ok: true, verifyDurationMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return { ok: false, reason: (error as Error).message, verifyDurationMs: Math.round(performance.now() - startedAt) };
    }
  }

  async generateSettlementReceipt(inputs: SettlementProveInputs): Promise<MidnightSettlementReceipt> {
    return this.withSubmissionLock(() => this.generateSettlementReceiptUnlocked(inputs));
  }

  private async generateSettlementReceiptUnlocked(inputs: SettlementProveInputs): Promise<MidnightSettlementReceipt> {
    const startedAtMs = Date.now();
    const digest = normalizeHex32("settlement digest", inputs.settlementDigest);
    if (digest === ZERO_32) throw new Error("Settlement digest must be nonzero");
    const baseValidation = validateIntentReceipt(inputs.intentReceipt, {
      intentId: inputs.intentReceipt.intentId,
      cardanoLockAnchor: inputs.intentReceipt.cardanoLockAnchor,
      payeeCommitment: inputs.intentReceipt.publicInputs.payeeCommitment,
      amountCommitment: inputs.intentReceipt.publicInputs.amountCommitment,
      adapterTag: inputs.intentReceipt.publicInputs.adapterTag,
      complianceFlag: inputs.intentReceipt.publicInputs.complianceFlag,
    });
    if (!baseValidation.ok) throw new Error(`Invalid intent receipt: ${baseValidation.reason}`);
    const onlineValidation = await this.verifyIntentReceipt(inputs.intentReceipt, {
      intentId: inputs.intentReceipt.intentId,
      cardanoLockAnchor: inputs.intentReceipt.cardanoLockAnchor,
      payeeCommitment: inputs.intentReceipt.publicInputs.payeeCommitment,
      amountCommitment: inputs.intentReceipt.publicInputs.amountCommitment,
      adapterTag: inputs.intentReceipt.publicInputs.adapterTag,
      complianceFlag: inputs.intentReceipt.publicInputs.complianceFlag,
    });
    if (!onlineValidation.ok) {
      throw new Error(`Intent receipt is not finalized on Midnight: ${onlineValidation.reason}`);
    }

    const providers = await this.prepareForSubmission();
    const contract = await findDeployedContract(providers, {
      compiledContract: offRampCompiledContract,
      contractAddress: inputs.intentReceipt.contractAddress,
      privateStateId: offRampPrivateStateId,
    });
    const before = await readPublicState(providers, inputs.intentReceipt.contractAddress);
    if (!before.amountBound) throw new Error("Amount binding must finalize before settlement");
    if (before.settlementDigest !== ZERO_32) throw new Error("Settlement digest already recorded");

    const tx = finalizedTx(
      "proveOffRampSettlement",
      (await contract.callTx.proveOffRampSettlement(bytes32("settlement digest", digest))).public,
    );
    const state = await readPublicState(providers, inputs.intentReceipt.contractAddress);
    if (state.settlementDigest !== digest) throw new Error("Final Midnight ledger settlement digest mismatch");

    return finalizeSettlementReceipt({
      kind: "midnight-settlement-receipt",
      version: 1,
      contractId: "offramp",
      intentId: inputs.intentReceipt.intentId,
      intentReceiptHash: inputs.intentReceipt.receiptHash,
      cardanoLockAnchor: inputs.intentReceipt.cardanoLockAnchor,
      contractAddress: inputs.intentReceipt.contractAddress,
      network: this.config.networkId,
      artifactManifestHash: this.artifactManifestHash,
      settlementDigest: digest,
      transaction: tx,
      publicState: state,
      timestamps: { startedAtMs, completedAtMs: Date.now() },
    });
  }

  async verifySettlementReceipt(
    receipt: MidnightSettlementReceipt,
    expected: ExpectedSettlementReceipt,
  ): Promise<VerifyResult> {
    const startedAt = performance.now();
    const canonical = validateSettlementReceipt(receipt, expected);
    if (!canonical.ok) return { ...canonical, verifyDurationMs: Math.round(performance.now() - startedAt) };
    if (receipt.network !== this.config.networkId) {
      return { ok: false, reason: "Midnight network mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
    }
    try {
      const { providers } = await this.runtime();
      const txReason = await verifyFinalizedTx(this.config.indexer, receipt.transaction);
      if (txReason) return { ok: false, reason: txReason, verifyDurationMs: Math.round(performance.now() - startedAt) };
      const state = await readPublicState(providers, receipt.contractAddress, receipt.transaction.blockHeight);
      if (publicStateHash(state) !== receipt.publicStateHash) {
        return { ok: false, reason: "Finalized Midnight settlement state mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
      }
      return { ok: true, verifyDurationMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return { ok: false, reason: (error as Error).message, verifyDurationMs: Math.round(performance.now() - startedAt) };
    }
  }
}

export function createMidnightProofProviderFromEnv(): MidnightLocalProofProvider {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic) {
    throw new Error("BIP39_MNEMONIC is required to configure the real Midnight proof provider");
  }
  return new MidnightLocalProofProvider(new OffRampMidnightConfig(), mnemonic);
}
