/** Public-facing SDK types. See SRS FR-5 and TAD §7.1. */

export type RailId = "cashapp" | "wise" | "revolut";
export type Currency = "USD" | "EUR" | "GBP";
export type Status = "PENDING" | "LOCKED" | "PROVED" | "SUBMITTED" | "SETTLED" | "RELEASED" | "FAILED" | "REFUNDED";

export interface IntentParams {
  adapter: RailId;
  payeeHandle: string;     // e.g. cashtag, IBAN, Revolut tag (never logged in cleartext)
  amountAda: number;       // ADA principal escrowed
  fiatAmount: string;      // e.g. "12.50"
  fiatCurrency: Currency;
  jurisdiction?: string;   // optional KYC tag, hashed off-chain
}

export interface InitiateOffRampResult {
  intentId: string;        // 64-hex SHA-256 digest
  payeeCommitment: string; // 64-hex
  amountCommitment: string; // 64-hex
  adapterTag: string;      // 64-hex
  payeeSalt: string;       // 32-hex (16 bytes) — kept in private state
  amountSalt: string;      // 32-hex
  deadline: number;        // POSIX seconds
  vkHash: string;          // 64-hex deterministic Compact/compiler/verifier artifact manifest hash
  escrowLovelace: bigint;
}

export interface CardanoLockAnchor {
  txHash: string;
  outputIndex: number;
}

export type MidnightCircuitName =
  | "bindOffRampIntent"
  | "provePayeeBinding"
  | "proveAmountBinding"
  | "proveComplianceFlag"
  | "proveOffRampSettlement";

export interface FinalizedMidnightTxIdentifiers {
  operation: "deploy" | MidnightCircuitName;
  status: "SucceedEntirely";
  txId: string;
  identifiers: string[];
  txHash: string;
  blockHash: string;
  blockHeight: number;
  blockTimestamp: number;
  finalizedAtMs: number;
}

export interface MidnightPublicState {
  intentId: string;
  payeeCommitment: string;
  amountCommitment: string;
  adapterTag: string;
  l1Anchor: string;
  complianceFlag: string;
  settlementDigest: string;
  payeeBound: boolean;
  amountBound: boolean;
  complianceProved: boolean;
}

export interface MidnightReceiptTimestamps {
  startedAtMs: number;
  completedAtMs: number;
}

export interface MidnightIntentReceipt {
  kind: "midnight-intent-receipt";
  version: 1;
  contractId: "offramp";
  intentId: string;
  cardanoLockAnchor: CardanoLockAnchor;
  contractAddress: string;
  network: string;
  artifactManifestHash: string;
  publicInputs: {
    payeeCommitment: string;
    amountCommitment: string;
    adapterTag: string;
    complianceFlag?: string;
  };
  transactions: {
    deployment: FinalizedMidnightTxIdentifiers;
    bindOffRampIntent: FinalizedMidnightTxIdentifiers;
    provePayeeBinding: FinalizedMidnightTxIdentifiers;
    proveAmountBinding: FinalizedMidnightTxIdentifiers;
    proveComplianceFlag?: FinalizedMidnightTxIdentifiers;
  };
  publicState: MidnightPublicState;
  publicStateHash: string;
  timestamps: MidnightReceiptTimestamps;
  receiptHash: string;
}

export interface MidnightSettlementReceipt {
  kind: "midnight-settlement-receipt";
  version: 1;
  contractId: "offramp";
  intentId: string;
  intentReceiptHash: string;
  cardanoLockAnchor: CardanoLockAnchor;
  contractAddress: string;
  network: string;
  artifactManifestHash: string;
  settlementDigest: string;
  transaction: FinalizedMidnightTxIdentifiers;
  publicState: MidnightPublicState;
  publicStateHash: string;
  timestamps: MidnightReceiptTimestamps;
  receiptHash: string;
}

/** Backward-compatible name for the proof value accepted by rail adapters. */
export type ProofBundle = MidnightIntentReceipt;

export type RailMode = "mock" | "sandbox";
export type RailProviderStatus = "SUBMITTED" | "PROCESSING" | "SETTLED" | "FAILED";

export interface RailCapabilities {
  providerQuote: boolean;
  idempotentSubmit: boolean;
  authenticatedStatus: boolean;
  webhookVerification: boolean;
  sandboxEvidenceDriver: boolean;
}

export interface RailAdapterHealth {
  adapter: RailId;
  requestedMode: RailMode;
  effectiveMode: RailMode;
  ready: boolean;
  configured: boolean;
  missingEnv: string[];
  capabilities: RailCapabilities;
}

export interface RailQuote {
  adapter: RailId;
  fiatAmount: string;
  fiatCurrency: Currency;
  railQuoteDigest: string; // 64-hex commitment to provider rate/fees at quote time
  quotedAt: number;        // POSIX seconds
  expiresAt?: number;      // POSIX seconds, exactly as supplied by the provider
  providerQuoteId?: string;
  rate: string;
  fees: string;
  sourceAmount?: string;
  targetAmount?: string;
}

export interface RailProviderReference {
  id: string;
  idempotencyKey: string;
  quoteId?: string;
  recipientId?: string;
}

export interface SubmitPaymentInput {
  intentId: string;
  proof: ProofBundle;
  payeeHandle: string;
  quote: RailQuote;
}

export interface SubmitPaymentResult {
  railTxRef: string;
  status: "ACCEPTED" | "REJECTED";
  providerStatus: RailProviderStatus;
  providerReference: RailProviderReference;
  raw?: Record<string, unknown>;
}

export interface RailStatusObservation {
  railTxRef: string;
  providerStatus: RailProviderStatus;
  providerState: string;
  observedAt: number;
  raw?: Record<string, unknown>;
}

export interface RailWebhookInput {
  rawBody: string | Uint8Array;
  headers: Record<string, string | undefined>;
  path?: string;
}

export interface RailWebhookVerification {
  valid: boolean;
  reason?: string;
  providerEventId?: string;
  providerReferenceId?: string;
  providerState?: string;
  providerStatus?: RailProviderStatus;
}

export interface OracleAttestation {
  intentId: string;
  status: "SETTLED" | "FAILED";
  railTxRef: string;
  settlementDigest: string; // 64-hex
  signature: string;        // 128-hex ed25519
  signedAt: number;
}

export interface RailAdapter {
  readonly id: RailId;
  readonly mode: RailMode;
  readonly capabilities: RailCapabilities;
  health(): RailAdapterHealth;
  /** Quote ADA→fiat for the given intent. */
  quote(input: { fiatAmount: string; fiatCurrency: Currency }): Promise<RailQuote>;
  /** Submit the fiat payout. Must be idempotent on `intentId`. */
  submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult>;
  /** Authenticated provider observation; only terminal success may return SETTLED. */
  getStatus(input: {
    intentId: string;
    providerReference: RailProviderReference;
  }): Promise<RailStatusObservation>;
  /** Verify provider-native webhook bytes and headers. */
  verifyWebhook(input: RailWebhookInput): RailWebhookVerification;
  /** Available only on explicitly named mock adapters used by tests. */
  emitTestWebhook?(intentId: string, status: "SETTLED" | "FAILED"): Promise<{
    rawBody: string;
    headers: Record<string, string>;
  }>;
}

export interface IntentRecord extends IntentParams {
  intentId: string;
  status: Status;
  initiate: InitiateOffRampResult;
  cardanoLockTx?: string;
  cardanoReleaseTx?: string;
  cardanoRefundTx?: string;
  midnightContractAddress?: string;
  proof?: ProofBundle;
  settlementReceipt?: MidnightSettlementReceipt;
  quote?: RailQuote;
  railTxRef?: string;
  railIdempotencyKey?: string;
  providerReference?: RailProviderReference;
  providerStatus?: RailProviderStatus;
  providerStatusObservedAt?: number;
  oracle?: OracleAttestation;
  errors: string[];
  createdAt: number;
  updatedAt: number;
}
