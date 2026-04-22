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
  vkHash: string;          // 64-hex — pinned circuit verification key id
  escrowLovelace: bigint;
}

export interface ProofBundle {
  intentId: string;
  circuitId: string;       // human-readable: "offramp:v1"
  vkHash: string;          // 64-hex
  publicInputs: {
    payeeCommitment: string;
    amountCommitment: string;
    adapterTag: string;
    complianceFlag?: string;
    settlementDigest?: string;
  };
  pi: string;              // 64-hex digest standing in for serialized SNARK proof
  generatedAtMs: number;
  proveDurationMs: number;
}

export interface RailQuote {
  adapter: RailId;
  fiatAmount: string;
  fiatCurrency: Currency;
  railQuoteDigest: string; // 64-hex commitment to provider rate/fees at quote time
  quotedAt: number;        // POSIX seconds
}

export interface SubmitPaymentInput {
  intentId: string;
  proof: ProofBundle;
  payeeHandle: string;
  quote: RailQuote;
}

export interface SubmitPaymentResult {
  railTxRef: string;       // provider reference (sandbox / mock)
  status: "ACCEPTED" | "REJECTED";
  webhookHmac: string;     // adapter-signed canonical event for the oracle
  raw?: Record<string, unknown>;
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
  /** Quote ADA→fiat for the given intent. */
  quote(input: { fiatAmount: string; fiatCurrency: Currency }): Promise<RailQuote>;
  /** Submit the fiat payout (sandbox / mock). Must be idempotent on `intentId`. */
  submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult>;
  /** Emit a webhook payload (sandbox / mock) that the Settlement Oracle will sign. */
  emitWebhook(intentId: string, status: "SETTLED" | "FAILED"): Promise<{ payload: Record<string, unknown>; hmac: string }>;
}

export interface IntentRecord extends IntentParams {
  intentId: string;
  status: Status;
  initiate: InitiateOffRampResult;
  cardanoLockTx?: string;
  cardanoReleaseTx?: string;
  cardanoRefundTx?: string;
  proof?: ProofBundle;
  quote?: RailQuote;
  railTxRef?: string;
  oracle?: OracleAttestation;
  errors: string[];
  createdAt: number;
  updatedAt: number;
}
