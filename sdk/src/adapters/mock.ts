import { createHash, createHmac } from "node:crypto";
import { railQuoteDigest } from "../commitments.js";
import type {
  Currency,
  RailAdapter,
  RailCapabilities,
  RailId,
  RailProviderStatus,
  RailQuote,
  SubmitPaymentInput,
  SubmitPaymentResult,
} from "../types.js";
import {
  adapterHealth,
  adapterRuntime,
  deterministicUuid,
  header,
  safeEqualHex,
  type AdapterDependencies,
} from "./common.js";

interface RateProfile {
  rate: Record<Currency, number>;
  feeBps: number;
}

const RATE_PROFILES: Record<RailId, RateProfile> = {
  cashapp: { rate: { USD: 1, EUR: 0.92, GBP: 0.79 }, feeBps: 75 },
  wise: { rate: { USD: 1, EUR: 0.92, GBP: 0.79 }, feeBps: 40 },
  revolut: { rate: { USD: 1, EUR: 0.92, GBP: 0.79 }, feeBps: 30 },
};

const CAPABILITIES: RailCapabilities = {
  providerQuote: false,
  idempotentSubmit: true,
  authenticatedStatus: true,
  webhookVerification: true,
  sandboxEvidenceDriver: false,
};

function mockStatus(env: NodeJS.ProcessEnv, adapter: RailId): RailProviderStatus {
  const value = env[`MOCK_RAIL_STATUS_${adapter.toUpperCase()}`]?.toUpperCase();
  if (value === "SUBMITTED" || value === "PROCESSING" || value === "SETTLED" || value === "FAILED") return value;
  return "SETTLED";
}

export function buildMockQuote(adapter: RailId, input: { fiatAmount: string; fiatCurrency: Currency }): RailQuote {
  const profile = RATE_PROFILES[adapter];
  const rate = String(profile.rate[input.fiatCurrency]);
  const fees = ((Number(input.fiatAmount) * profile.feeBps) / 10_000).toFixed(2);
  const quotedAt = 0;
  return {
    adapter,
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    railQuoteDigest: railQuoteDigest({
      adapter,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      rate: Number(rate),
      fees,
      quotedAt,
    }),
    quotedAt,
    providerQuoteId: `mock-${createHash("sha256").update(`${adapter}:${input.fiatAmount}:${input.fiatCurrency}`).digest("hex").slice(0, 24)}`,
    rate,
    fees,
    targetAmount: input.fiatAmount,
  };
}

export function createDeterministicMockAdapter(adapter: RailId, deps: AdapterDependencies = {}): RailAdapter {
  const runtime = adapterRuntime({ ...deps, env: { ...(deps.env ?? process.env), RAIL_ADAPTER_MODE: "mock" } });
  const key = runtime.env.RAIL_WEBHOOK_HMAC_KEY ?? "offramp-dev-shared-hmac-key";

  function sign(rawBody: string): string {
    return createHmac("sha256", key).update(rawBody).digest("hex");
  }

  return {
    id: adapter,
    mode: "mock",
    capabilities: CAPABILITIES,
    health: () => adapterHealth({ adapter, mode: "mock", missing: [], capabilities: CAPABILITIES }),
    async quote(input) {
      return buildMockQuote(adapter, input);
    },
    async submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
      const idempotencyKey = deterministicUuid(`mock-${adapter}`, input.intentId);
      const id = `${adapter}-${idempotencyKey}`;
      const providerStatus = mockStatus(runtime.env, adapter);
      return {
        railTxRef: id,
        status: providerStatus === "FAILED" ? "REJECTED" : "ACCEPTED",
        providerStatus: providerStatus === "SETTLED" ? "SUBMITTED" : providerStatus,
        providerReference: {
          id,
          idempotencyKey,
          quoteId: input.quote.providerQuoteId,
        },
        raw: { provider: adapter, mode: "mock" },
      };
    },
    async getStatus(input) {
      const status = mockStatus(runtime.env, adapter);
      return {
        railTxRef: input.providerReference.id,
        providerStatus: status,
        providerState: status.toLowerCase(),
        observedAt: runtime.now(),
        raw: { provider: adapter, mode: "mock" },
      };
    },
    verifyWebhook(input) {
      const supplied = header(input.headers, "x-offramp-mock-signature") ?? "";
      const rawBody = typeof input.rawBody === "string" ? input.rawBody : Buffer.from(input.rawBody).toString("utf8");
      const expected = sign(rawBody);
      if (!safeEqualHex(supplied, expected)) return { valid: false, reason: "mock webhook signature mismatch" };
      try {
        const payload = JSON.parse(rawBody) as { event_id?: string; rail_tx_ref?: string; status?: string };
        const providerStatus = payload.status === "SETTLED" || payload.status === "FAILED" ? payload.status : undefined;
        return {
          valid: true,
          providerEventId: payload.event_id,
          providerReferenceId: payload.rail_tx_ref,
          providerState: payload.status,
          providerStatus,
        };
      } catch {
        return { valid: false, reason: "mock webhook JSON invalid" };
      }
    },
    async emitTestWebhook(intentId, status) {
      const railTxRef = `${adapter}-${deterministicUuid(`mock-${adapter}`, intentId)}`;
      const rawBody = JSON.stringify({
        event_id: deterministicUuid(`mock-${adapter}-event-${status}`, intentId),
        intent_id: intentId,
        rail_tx_ref: railTxRef,
        adapter,
        status,
        occurred_at: new Date(runtime.now()).toISOString(),
      });
      return { rawBody, headers: { "x-offramp-mock-signature": sign(rawBody) } };
    },
  };
}

export const mockCashAppAdapter = createDeterministicMockAdapter("cashapp");
export const mockWiseAdapter = createDeterministicMockAdapter("wise");
export const mockRevolutAdapter = createDeterministicMockAdapter("revolut");
