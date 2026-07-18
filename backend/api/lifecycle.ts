/**
 * Off-ramp intent lifecycle: explicit state machine + capability-token auth
 * helpers + persistence redaction.
 *
 * States (happy path, in order):
 *   CREATED → LOCK_SUBMITTED → LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED
 *   → PAYMENT_SUBMITTED → SETTLEMENT_CONFIRMED → MIDNIGHT_SETTLEMENT_PROVED
 *   → RELEASE_AUTHORIZED → RELEASED
 *
 * Terminals: RELEASED, PAYMENT_FAILED, REFUNDED.
 * PAYMENT_FAILED → REFUNDED is additionally allowed so the sender can recover
 * the escrow after the fiat leg failed (the payment leg itself stays terminal).
 *
 * Every mutation must go through `assertTransition`; callers are expected to
 * treat repeated requests for an already-reached state as idempotent replays.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  Currency,
  MidnightIntentReceipt,
  MidnightSettlementReceipt,
  OracleAttestation,
  RailId,
  RailProviderReference,
  RailProviderStatus,
  RailQuote,
} from "../../sdk/src/types.ts";

// ── State machine ────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  "CREATED",
  "LOCK_SUBMITTED",
  "LOCK_CONFIRMED",
  "MIDNIGHT_INTENT_PROVED",
  "PAYMENT_SUBMITTED",
  "SETTLEMENT_CONFIRMED",
  "MIDNIGHT_SETTLEMENT_PROVED",
  "RELEASE_AUTHORIZED",
  "RELEASED",
  "PAYMENT_FAILED",
  "REFUNDED",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  CREATED: ["LOCK_SUBMITTED"],
  LOCK_SUBMITTED: ["LOCK_CONFIRMED", "REFUNDED"],
  LOCK_CONFIRMED: ["MIDNIGHT_INTENT_PROVED", "REFUNDED"],
  MIDNIGHT_INTENT_PROVED: ["PAYMENT_SUBMITTED", "PAYMENT_FAILED", "REFUNDED"],
  PAYMENT_SUBMITTED: ["SETTLEMENT_CONFIRMED", "PAYMENT_FAILED", "REFUNDED"],
  SETTLEMENT_CONFIRMED: ["MIDNIGHT_SETTLEMENT_PROVED"],
  MIDNIGHT_SETTLEMENT_PROVED: ["RELEASE_AUTHORIZED"],
  RELEASE_AUTHORIZED: ["RELEASED"],
  RELEASED: [],
  PAYMENT_FAILED: ["REFUNDED"],
  REFUNDED: [],
};

export const TERMINAL_STATES: readonly LifecycleState[] = ["RELEASED", "PAYMENT_FAILED", "REFUNDED"];

export class LifecycleError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 409) {
    super(message);
    this.name = "LifecycleError";
    this.httpStatus = httpStatus;
  }
}

export function allowedTargets(from: LifecycleState): readonly LifecycleState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Which source states may transition into `to`. */
export function sourcesFor(to: LifecycleState): LifecycleState[] {
  return LIFECYCLE_STATES.filter((s) => TRANSITIONS[s].includes(to));
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new LifecycleError(
      `invalid state transition ${from} → ${to}; ${to} requires one of [${sourcesFor(to).join(", ")}]`,
    );
  }
}

/** True if `state` is at or beyond `other` on the happy path (used for idempotent replays). */
export function atOrAfter(state: LifecycleState, other: LifecycleState): boolean {
  const happyPath = LIFECYCLE_STATES.slice(0, 9) as readonly LifecycleState[];
  const a = happyPath.indexOf(state);
  const b = happyPath.indexOf(other);
  if (a === -1 || b === -1) return state === other;
  return a >= b;
}

// ── Capability tokens ────────────────────────────────────────────────────
// A per-intent bearer secret returned exactly once by /api/offramp/initiate.
// Only its SHA-256 hash is ever persisted.

export function newCapabilityToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function capabilityTokenMatches(presented: string | undefined, storedHash: string | undefined): boolean {
  if (!presented || !storedHash) return false;
  // Hash the presented token first so the comparison is constant-time and
  // length-independent.
  const a = Buffer.from(hashCapabilityToken(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Persistence redaction ────────────────────────────────────────────────
// Cleartext payee handles, salts, KYC tags, and raw capability tokens must
// never reach disk or read responses. Only commitments / hashes / receipts /
// chain references are allowed to persist.

export const SENSITIVE_KEYS = [
  "payeeHandle",
  "payeeSalt",
  "amountSalt",
  "jurisdiction",
  "capabilityToken",
] as const;

export function deepRedact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepRedact(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((SENSITIVE_KEYS as readonly string[]).includes(k)) continue;
      out[k] = deepRedact(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ── Stored record shape ──────────────────────────────────────────────────

/** InitiateOffRampResult minus the salts (which are returned once, never stored). */
export interface StoredInitiate {
  intentId: string;
  payeeCommitment: string;
  amountCommitment: string;
  adapterTag: string;
  deadline: number; // POSIX seconds
  vkHash: string;
  escrowLovelace: bigint;
}

export interface TransitionEvent {
  from: LifecycleState;
  to: LifecycleState;
  at: number;
}

export interface ReleaseAuthorizationRecord {
  authorizationMessageCbor: string;
  settlementDigest: string;
  midnightSettlementReceiptHash: string;
  authorizationExpiryMs: string; // bigint ms as decimal string
  oracleSignature: string;
}

export interface StoredIntentRecord {
  intentId: string;
  state: LifecycleState;
  adapter: RailId;
  amountAda: number;
  fiatAmount: string;
  fiatCurrency: Currency;
  /** SHA-256 of the per-intent capability token. Never the token itself. */
  capabilityTokenHash: string;
  initiate: StoredInitiate;
  quote?: RailQuote;
  scriptAddress?: string;
  cardanoLockTx?: string;
  lockOutputIndex?: number;
  cardanoReleaseTx?: string;
  cardanoRefundTx?: string;
  midnightContractAddress?: string;
  proof?: MidnightIntentReceipt;
  settlementReceipt?: MidnightSettlementReceipt;
  railTxRef?: string;
  providerReference?: RailProviderReference;
  providerStatus?: RailProviderStatus;
  providerStatusObservedAt?: number;
  oracle?: OracleAttestation;
  releaseAuthorization?: ReleaseAuthorizationRecord;
  history: TransitionEvent[];
  errors: string[];
  createdAt: number;
  updatedAt: number;
}

/** Detail view returned to an authorized caller: everything except the token hash. */
export function intentDetailView(rec: StoredIntentRecord): Omit<StoredIntentRecord, "capabilityTokenHash"> {
  const { capabilityTokenHash: _hash, ...rest } = rec;
  return deepRedact(rest);
}

/** Minimal unauthenticated summary. */
export function intentSummaryView(rec: StoredIntentRecord): {
  intentId: string;
  state: LifecycleState;
  adapter: RailId;
  createdAt: number;
  updatedAt: number;
} {
  return {
    intentId: rec.intentId,
    state: rec.state,
    adapter: rec.adapter,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
