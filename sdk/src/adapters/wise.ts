import { verify as verifySignature } from "node:crypto";
import { railQuoteDigest } from "../commitments.js";
import type {
  Currency,
  RailAdapter,
  RailCapabilities,
  RailProviderStatus,
  RailQuote,
  SubmitPaymentInput,
  SubmitPaymentResult,
} from "../types.js";
import {
  adapterHealth,
  adapterRuntime,
  assertConfigured,
  bytes,
  deterministicUuid,
  fetchWithTimeout,
  header,
  missingEnv,
  normalizeTerminalStatus,
  responseJson,
  type AdapterDependencies,
} from "./common.js";
import { createDeterministicMockAdapter } from "./mock.js";

const WISE_SANDBOX_BASE = "https://api.wise-sandbox.com";
const REQUIRED_ENV = [
  "WISE_API_TOKEN",
  "WISE_PROFILE_ID",
  "WISE_RECIPIENT_ID",
  "WISE_SOURCE_CURRENCY",
  "WISE_WEBHOOK_PUBLIC_KEY_PEM",
] as const;

const CAPABILITIES: RailCapabilities = {
  providerQuote: true,
  idempotentSubmit: true,
  authenticatedStatus: true,
  webhookVerification: true,
  sandboxEvidenceDriver: true,
};

interface WiseQuoteResponse {
  id: string;
  rate: number;
  rateExpirationTime?: string;
  sourceAmount?: number;
  targetAmount?: number;
  paymentOptions?: Array<{
    disabled?: boolean;
    payIn?: string;
    payOut?: string;
    fee?: { total?: number };
  }>;
}

interface WiseTransferResponse {
  id: number;
  status: string;
  customerTransactionId?: string;
}

function wiseStatus(state: string): RailProviderStatus {
  return normalizeTerminalStatus(
    state,
    ["outgoing_payment_sent"],
    ["cancelled", "funds_refunded", "bounced_back", "charged_back"],
    ["incoming_payment_waiting", "incoming_payment_initiated"],
  );
}

export function createWiseAdapter(deps: AdapterDependencies = {}): RailAdapter {
  const runtime = adapterRuntime(deps);
  if (runtime.mode === "mock") return createDeterministicMockAdapter("wise", deps);

  const missing = missingEnv(runtime.env, REQUIRED_ENV);
  const baseUrl = runtime.env.WISE_API_BASE_URL?.replace(/\/$/, "") || WISE_SANDBOX_BASE;

  async function wiseFetch(path: string, init: RequestInit = {}): Promise<Response> {
    assertConfigured("wise", missing);
    return fetchWithTimeout(runtime, `${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${runtime.env.WISE_API_TOKEN}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  async function runEvidenceDriver(transferId: string): Promise<void> {
    const driver = (runtime.env.WISE_EVIDENCE_DRIVER ?? "none").toLowerCase();
    if (driver === "none" || driver === "") return;
    if (driver !== "balance" && driver !== "balance-and-settle") {
      throw new Error("WISE_EVIDENCE_DRIVER must be none, balance, or balance-and-settle");
    }
    const profileId = runtime.env.WISE_PROFILE_ID!;
    await responseJson("wise", await wiseFetch(
      `/v3/profiles/${encodeURIComponent(profileId)}/transfers/${encodeURIComponent(transferId)}/payments`,
      { method: "POST", body: JSON.stringify({ type: "BALANCE" }) },
    ));
    if (driver === "balance-and-settle") {
      await responseJson("wise", await wiseFetch(
        `/v1/simulation/transfers/${encodeURIComponent(transferId)}/status`,
        { method: "PUT", body: JSON.stringify({ status: "outgoing_payment_sent" }) },
      ));
    }
  }

  return {
    id: "wise",
    mode: "sandbox",
    capabilities: CAPABILITIES,
    health: () => adapterHealth({ adapter: "wise", mode: "sandbox", missing, capabilities: CAPABILITIES }),
    async quote(input: { fiatAmount: string; fiatCurrency: Currency }): Promise<RailQuote> {
      assertConfigured("wise", missing);
      const profileId = runtime.env.WISE_PROFILE_ID!;
      const response = await wiseFetch(`/v3/profiles/${encodeURIComponent(profileId)}/quotes`, {
        method: "POST",
        body: JSON.stringify({
          sourceCurrency: runtime.env.WISE_SOURCE_CURRENCY,
          targetCurrency: input.fiatCurrency,
          targetAmount: Number(input.fiatAmount),
          payOut: "BANK_TRANSFER",
          preferredPayIn: "BALANCE",
        }),
      });
      const quote = await responseJson<WiseQuoteResponse>("wise", response);
      const paymentOption = quote.paymentOptions?.find((option) =>
        !option.disabled && option.payIn?.toUpperCase() === "BALANCE",
      ) ?? quote.paymentOptions?.find((option) => !option.disabled) ?? quote.paymentOptions?.[0];
      const rate = String(quote.rate);
      const fees = String(paymentOption?.fee?.total ?? "0");
      const quotedAt = Math.floor(runtime.now() / 1000);
      const expiresAt = quote.rateExpirationTime
        ? Math.floor(Date.parse(quote.rateExpirationTime) / 1000)
        : undefined;
      return {
        adapter: "wise",
        fiatAmount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
        railQuoteDigest: railQuoteDigest({
          adapter: "wise",
          fiatAmount: input.fiatAmount,
          fiatCurrency: input.fiatCurrency,
          rate: Number(rate),
          fees,
          quotedAt,
        }),
        quotedAt,
        expiresAt,
        providerQuoteId: quote.id,
        rate,
        fees,
        sourceAmount: quote.sourceAmount == null ? undefined : String(quote.sourceAmount),
        targetAmount: quote.targetAmount == null ? input.fiatAmount : String(quote.targetAmount),
      };
    },
    async submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
      assertConfigured("wise", missing);
      if (!input.quote.providerQuoteId) throw new Error("wise submission requires the committed providerQuoteId");
      if (input.quote.expiresAt && input.quote.expiresAt <= Math.floor(runtime.now() / 1000)) {
        throw new Error("wise committed quote has expired");
      }
      const idempotencyKey = deterministicUuid("wise-transfer", input.intentId);
      const recipientId = runtime.env.WISE_RECIPIENT_ID!;
      const transfer = await responseJson<WiseTransferResponse>("wise", await wiseFetch("/v1/transfers", {
        method: "POST",
        body: JSON.stringify({
          targetAccount: Number(recipientId),
          quoteUuid: input.quote.providerQuoteId,
          customerTransactionId: idempotencyKey,
          details: {
            reference: `OFFRAMP-${input.intentId.slice(0, 12)}`,
            transferPurpose: runtime.env.WISE_TRANSFER_PURPOSE ?? "verification.transfers.purpose.pay.bills",
            sourceOfFunds: runtime.env.WISE_SOURCE_OF_FUNDS ?? "verification.source.of.funds.other",
          },
        }),
      }));
      const transferId = String(transfer.id);
      await runEvidenceDriver(transferId);
      return {
        railTxRef: transferId,
        status: "ACCEPTED",
        // Creation is submission, never settlement. Settlement comes from getStatus().
        providerStatus: "SUBMITTED",
        providerReference: {
          id: transferId,
          idempotencyKey,
          quoteId: input.quote.providerQuoteId,
          recipientId,
        },
        raw: { provider: "wise", mode: "sandbox", providerState: transfer.status },
      };
    },
    async getStatus(input) {
      assertConfigured("wise", missing);
      const transfer = await responseJson<WiseTransferResponse>("wise", await wiseFetch(
        `/v1/transfers/${encodeURIComponent(input.providerReference.id)}`,
      ));
      return {
        railTxRef: String(transfer.id),
        providerStatus: wiseStatus(transfer.status),
        providerState: transfer.status,
        observedAt: runtime.now(),
        raw: { provider: "wise", mode: "sandbox" },
      };
    },
    verifyWebhook(input) {
      const pem = runtime.env.WISE_WEBHOOK_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
      if (!pem) return { valid: false, reason: "WISE_WEBHOOK_PUBLIC_KEY_PEM is not configured" };
      const supplied = header(input.headers, "x-signature-sha256");
      if (!supplied) return { valid: false, reason: "Wise signature header missing" };
      try {
        const valid = verifySignature("RSA-SHA256", bytes(input.rawBody), pem, Buffer.from(supplied, "base64"));
        if (!valid) return { valid: false, reason: "Wise webhook signature mismatch" };
        const payload = JSON.parse(bytes(input.rawBody).toString("utf8")) as {
          event_type?: string;
          data?: { resource?: { id?: number | string }; current_state?: string };
        };
        const state = payload.data?.current_state;
        return {
          valid: true,
          providerEventId: header(input.headers, "x-delivery-id"),
          providerReferenceId: payload.data?.resource?.id == null ? undefined : String(payload.data.resource.id),
          providerState: state,
          providerStatus: state ? wiseStatus(state) : undefined,
        };
      } catch {
        return { valid: false, reason: "Wise webhook payload or signature is invalid" };
      }
    },
  };
}

export const wiseAdapter = createWiseAdapter();
