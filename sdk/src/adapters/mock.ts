/**
 * Shared mock-sandbox helpers used by the Cash App / Wise / Revolut adapters.
 *
 * The mock path simulates real provider behavior:
 * - `quote`: returns a deterministic rail rate + fee schedule per adapter
 * - `submit`: returns a `rail_tx_ref` and an HMAC-signed canonical event the
 *   Settlement Oracle can verify
 * - `emitWebhook`: produces a sandbox webhook payload mirroring what each
 *   provider would POST to the operator's endpoint
 *
 * When `RAIL_ADAPTER_MODE=sandbox` and real provider credentials are present,
 * adapters should override these defaults with live HTTP calls.
 */
import { createHmac, randomUUID } from "node:crypto";
import { railQuoteDigest } from "../commitments.ts";
import type { Currency, RailId, RailQuote, SubmitPaymentInput, SubmitPaymentResult } from "../types.ts";

const ADAPTER_HMAC_KEY = process.env.RAIL_WEBHOOK_HMAC_KEY ?? "offramp-dev-shared-hmac-key";

interface RateProfile {
  adapter: RailId;
  rate: Record<Currency, number>;
  feeBps: number;
  flatFee: Record<Currency, string>;
  successRate: number; // 0..1 — 0.95 means 1 in 20 webhooks return FAILED
}

const RATE_PROFILES: Record<RailId, RateProfile> = {
  cashapp: {
    adapter: "cashapp",
    rate: { USD: 1.0, EUR: 0.92, GBP: 0.79 },
    feeBps: 75,
    flatFee: { USD: "0.10", EUR: "0.10", GBP: "0.10" },
    successRate: 0.96,
  },
  wise: {
    adapter: "wise",
    rate: { USD: 1.0, EUR: 0.92, GBP: 0.79 },
    feeBps: 40,
    flatFee: { USD: "0.25", EUR: "0.25", GBP: "0.20" },
    successRate: 0.97,
  },
  revolut: {
    adapter: "revolut",
    rate: { USD: 1.0, EUR: 0.92, GBP: 0.79 },
    feeBps: 30,
    flatFee: { USD: "0.00", EUR: "0.00", GBP: "0.00" },
    successRate: 0.94,
  },
};

export function profileFor(adapter: RailId): RateProfile {
  return RATE_PROFILES[adapter];
}

export function buildQuote(adapter: RailId, input: { fiatAmount: string; fiatCurrency: Currency }): RailQuote {
  const profile = RATE_PROFILES[adapter];
  const fee = ((Number(input.fiatAmount) * profile.feeBps) / 10000).toFixed(2);
  const quotedAt = Math.floor(Date.now() / 1000);
  const digest = railQuoteDigest({
    adapter,
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    rate: profile.rate[input.fiatCurrency],
    fees: fee,
    quotedAt,
  });
  return {
    adapter,
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    railQuoteDigest: digest,
    quotedAt,
  };
}

export function buildRailTxRef(adapter: RailId): string {
  const prefix = adapter === "cashapp" ? "CA" : adapter === "wise" ? "WS" : "RV";
  return `${prefix}-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
}

export function hmac(payload: Record<string, unknown>): string {
  return createHmac("sha256", ADAPTER_HMAC_KEY)
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function buildWebhook(input: { intentId: string; status: "SETTLED" | "FAILED"; adapter: RailId; railTxRef: string }) {
  const payload = {
    rail_tx_ref: input.railTxRef,
    intent_id: input.intentId,
    adapter: input.adapter,
    status: input.status,
    occurred_at: new Date().toISOString(),
  };
  return { payload, hmac: hmac(payload) };
}

export function decideOutcome(adapter: RailId, intentId: string): "SETTLED" | "FAILED" {
  // Deterministic: hash intentId to a [0,1) value and compare to successRate.
  const bucket =
    parseInt(intentId.slice(0, 4), 16) / 0xffff;
  return bucket <= RATE_PROFILES[adapter].successRate ? "SETTLED" : "FAILED";
}

export function adapterSubmit(adapter: RailId, input: SubmitPaymentInput): SubmitPaymentResult {
  const status = decideOutcome(adapter, input.intentId);
  const railTxRef = buildRailTxRef(adapter);
  const wh = buildWebhook({ intentId: input.intentId, status, adapter, railTxRef });
  return {
    railTxRef,
    status: status === "SETTLED" ? "ACCEPTED" : "REJECTED",
    webhookHmac: wh.hmac,
    raw: { provider: adapter, mode: process.env.RAIL_ADAPTER_MODE ?? "mock", payload: wh.payload },
  };
}
