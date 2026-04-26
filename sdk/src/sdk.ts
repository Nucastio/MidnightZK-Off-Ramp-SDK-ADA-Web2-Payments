/**
 * OffRampSDK — public surface defined in SRS FR-5:
 *   initiateOffRamp(params)
 *   generateZKProof(inputs)
 *   submitPayment(adapter, proof)
 *   confirmSettlement(txHash)
 *
 * The SDK is stateless from the caller's perspective; the backend / wallet
 * holds the `IntentRecord`. This class wires the four steps together over
 * the same in-process modules used by the backend HTTP server.
 */
import { adapters, getAdapter } from "./adapters/index.ts";
import {
  adapterTag as buildAdapterTag,
  amountCommitment,
  intentId as deriveIntentId,
  payeeCommitment,
  randomNonce,
  vkHash,
} from "./commitments.ts";
import { prove, verify } from "./midnight/prove.ts";
import { attestSettlement, verifyAttestation, verifyAdapterWebhook } from "./oracle/settlement-oracle.ts";
import { OracleError, ProofVerifyError, RailError } from "./errors.ts";
import type {
  Currency,
  InitiateOffRampResult,
  IntentParams,
  OracleAttestation,
  ProofBundle,
  RailAdapter,
  RailId,
  RailQuote,
  SubmitPaymentResult,
} from "./types.ts";

const ESCROW_DEADLINE_SECONDS = Number(process.env.ESCROW_DEADLINE_SECONDS ?? "900");
const ESCROW_LOCK_LOVELACE = BigInt(process.env.ESCROW_LOCK_LOVELACE ?? "2000000");

export interface OffRampSDKConfig {
  /** Override the default ADA escrow size (in lovelace). */
  escrowLovelace?: bigint;
  /** Override the default deadline window (seconds from initiate). */
  deadlineSeconds?: number;
  /** Sender payment PKH used to bind the `intent_id`. */
  senderPkh: string;
  /** Operator PKH that will eventually sign Release. */
  operatorPkh: string;
}

export class OffRampSDK {
  constructor(readonly cfg: OffRampSDKConfig) {}

  /** Step 1: build commitments + intent metadata. Does NOT submit any tx. */
  async initiateOffRamp(params: IntentParams): Promise<{
    initiate: InitiateOffRampResult;
    payeeSalt: string;
    amountSalt: string;
    railQuote: RailQuote;
  }> {
    const adapter = getAdapter(params.adapter);
    const railQuote = await adapter.quote({
      fiatAmount: params.fiatAmount,
      fiatCurrency: params.fiatCurrency,
    });
    const payeeSalt = randomNonce(16);
    const amountSalt = randomNonce(16);
    const adapterTag = buildAdapterTag(params.adapter);
    const principal = this.cfg.escrowLovelace ?? ESCROW_LOCK_LOVELACE;
    const payee = payeeCommitment(params.payeeHandle, payeeSalt);
    const amount = amountCommitment({
      fiatAmount: params.fiatAmount,
      fiatCurrency: params.fiatCurrency,
      railQuoteDigest: railQuote.railQuoteDigest,
      principalLovelace: principal,
      salt: amountSalt,
    });
    const createdAt = Math.floor(Date.now() / 1000);
    const intent = deriveIntentId({
      adapter: params.adapter,
      senderPkh: this.cfg.senderPkh,
      payeeCommitment: payee.commitment,
      amountCommitment: amount.commitment,
      createdAt,
    });
    const deadline = createdAt + (this.cfg.deadlineSeconds ?? ESCROW_DEADLINE_SECONDS);
    const initiate: InitiateOffRampResult = {
      intentId: intent,
      payeeCommitment: payee.commitment,
      amountCommitment: amount.commitment,
      adapterTag,
      payeeSalt,
      amountSalt,
      deadline,
      vkHash: vkHash(),
      escrowLovelace: principal,
    };
    return { initiate, payeeSalt, amountSalt, railQuote };
  }

  /** Step 2: prove the off-ramp predicates. Returns a proof bundle bound to the intent. */
  async generateZKProof(input: {
    intentId: string;
    payeeHandle: string;
    payeeSalt: string;
    fiatAmount: string;
    fiatCurrency: Currency;
    railQuoteDigest: string;
    principalLovelace: bigint;
    amountSalt: string;
    adapterTag: string;
    complianceMask?: string;
  }): Promise<ProofBundle> {
    return prove(input);
  }

  /** Independent verifier (re-derive + check) — used by the backend before submitting payment. */
  async verifyZKProof(
    proof: ProofBundle,
    inputs: {
      payeeHandle: string;
      payeeSalt: string;
      fiatAmount: string;
      fiatCurrency: Currency;
      railQuoteDigest: string;
      principalLovelace: bigint;
      amountSalt: string;
    },
  ): Promise<{ ok: true; verifyDurationMs: number } | { ok: false; reason: string; verifyDurationMs: number }> {
    const v = await verify(proof, inputs);
    if (!v.ok) throw new ProofVerifyError(v.reason ?? "unknown");
    return { ok: true, verifyDurationMs: v.verifyDurationMs };
  }

  /** Step 3: submit the fiat payout via the rail adapter. */
  async submitPayment(input: {
    adapter: RailId;
    intentId: string;
    proof: ProofBundle;
    payeeHandle: string;
    quote: RailQuote;
  }): Promise<SubmitPaymentResult> {
    const adapter = getAdapter(input.adapter);
    const res = await adapter.submit({
      intentId: input.intentId,
      proof: input.proof,
      payeeHandle: input.payeeHandle,
      quote: input.quote,
    });
    if (res.status === "REJECTED") {
      throw new RailError(input.adapter, "adapter rejected submission");
    }
    return res;
  }

  /** Step 4: ingest a rail webhook + emit a signed Settlement Oracle attestation. */
  async confirmSettlement(input: {
    intentId: string;
    railTxRef: string;
    status: "SETTLED" | "FAILED";
    webhookPayload?: Record<string, unknown>;
    webhookHmac?: string;
  }): Promise<OracleAttestation> {
    if (input.webhookPayload && input.webhookHmac) {
      const ok = verifyAdapterWebhook(input.webhookPayload, input.webhookHmac);
      if (!ok) throw new OracleError("adapter webhook HMAC mismatch");
    }
    const att = attestSettlement({
      intentId: input.intentId,
      railTxRef: input.railTxRef,
      status: input.status,
    });
    if (!verifyAttestation(att)) {
      throw new OracleError("self-verify of attestation failed");
    }
    return att;
  }

  /** Convenience: list available rail adapters. */
  listAdapters(): RailAdapter[] {
    return Object.values(adapters);
  }
}
