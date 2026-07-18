import { createHash, createHmac } from "node:crypto";
import { railQuoteDigest } from "../commitments.js";
import type {
  Currency,
  RailAdapter,
  RailCapabilities,
  RailProviderStatus,
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
  safeEqualHex,
  type AdapterDependencies,
} from "./common.js";
import { createDeterministicMockAdapter } from "./mock.js";

const CASH_APP_SANDBOX_BASE = "https://sandbox.api.cash.app/network/v1";
const REQUIRED_ENV = [
  "CASH_APP_CLIENT_ID",
  "CASH_APP_KEY_ID",
  "CASH_APP_API_SECRET",
  "CASH_APP_MERCHANT_ID",
  "CASH_APP_GRANT_ID",
  "CASH_APP_REGION",
] as const;

const CAPABILITIES: RailCapabilities = {
  providerQuote: false,
  idempotentSubmit: true,
  authenticatedStatus: true,
  webhookVerification: true,
  sandboxEvidenceDriver: false,
};

interface CashAppPayout {
  payout_id: string;
  status: string;
  reference_id?: string;
}

interface CashAppPayoutResponse {
  payout: CashAppPayout;
}

function payoutStatus(state: string): RailProviderStatus {
  return normalizeTerminalStatus(state, ["captured"], ["declined"], ["initiated"]);
}

function usdMinorUnits(amount: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Cash App payout amount must have at most two decimal places");
  const [whole, fraction = ""] = amount.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor < 1) throw new Error("Cash App payout amount is outside supported range");
  return minor;
}

export function createCashAppAdapter(deps: AdapterDependencies = {}): RailAdapter {
  const runtime = adapterRuntime(deps);
  if (runtime.mode === "mock") return createDeterministicMockAdapter("cashapp", deps);

  const missing = missingEnv(runtime.env, REQUIRED_ENV);
  const baseUrl = runtime.env.CASH_APP_API_BASE_URL?.replace(/\/$/, "") || CASH_APP_SANDBOX_BASE;
  const base = new URL(baseUrl);

  function authorization(): string {
    return `Client ${runtime.env.CASH_APP_CLIENT_ID} ${runtime.env.CASH_APP_KEY_ID}`;
  }

  function signature(method: string, path: string, body: string, headers: Record<string, string>): string {
    const canonicalHeaders = ["accept", "authorization", "content-type", "host"]
      .filter((name) => headers[name] != null)
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join("");
    const bodyDigest = createHash("sha256").update(body).digest("hex");
    const canonical = `${method.toUpperCase()}\n${path}\n${canonicalHeaders}${bodyDigest}`;
    return createHmac("sha256", runtime.env.CASH_APP_API_SECRET!).update(canonical).digest("hex");
  }

  async function cashFetch(method: string, path: string, body?: Record<string, unknown>): Promise<Response> {
    assertConfigured("cashapp", missing);
    const rawBody = body ? JSON.stringify(body) : "";
    const signedHeaders: Record<string, string> = {
      accept: "application/json",
      authorization: authorization(),
      host: base.host,
    };
    if (body) signedHeaders["content-type"] = "application/json";
    return fetchWithTimeout(runtime, `${baseUrl}${path}`, {
      method,
      body: body ? rawBody : undefined,
      headers: {
        Accept: signedHeaders.accept,
        Authorization: signedHeaders.authorization,
        ...(body ? { "Content-Type": signedHeaders["content-type"] } : {}),
        Host: signedHeaders.host,
        "User-Agent": runtime.env.CASH_APP_USER_AGENT ?? "midnightzk-offramp-sdk/0.1.0",
        "X-Region": runtime.env.CASH_APP_REGION!,
        "X-Signature": `V1 ${signature(method, path, rawBody, signedHeaders)}`,
      },
    });
  }

  return {
    id: "cashapp",
    mode: "sandbox",
    capabilities: CAPABILITIES,
    health: () => adapterHealth({ adapter: "cashapp", mode: "sandbox", missing, capabilities: CAPABILITIES }),
    async quote(input) {
      assertConfigured("cashapp", missing);
      if (input.fiatCurrency !== "USD") throw new Error("Cash App Payouts currently supports USD only");
      const quotedAt = Math.floor(runtime.now() / 1000);
      const rate = "1";
      const fees = "0";
      return {
        adapter: "cashapp",
        fiatAmount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency as Currency,
        railQuoteDigest: railQuoteDigest({
          adapter: "cashapp",
          fiatAmount: input.fiatAmount,
          fiatCurrency: input.fiatCurrency,
          rate: Number(rate),
          fees,
          quotedAt,
        }),
        quotedAt,
        rate,
        fees,
        targetAmount: input.fiatAmount,
      };
    },
    async submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
      assertConfigured("cashapp", missing);
      if (input.quote.fiatCurrency !== "USD") throw new Error("Cash App Payouts currently supports USD only");
      const idempotencyKey = deterministicUuid("cashapp-payout", input.intentId);
      const result = await responseJson<CashAppPayoutResponse>("cashapp", await cashFetch("POST", "/payouts", {
        idempotency_key: idempotencyKey,
        payout: {
          amount: usdMinorUnits(input.quote.fiatAmount),
          currency: "USD",
          merchant_id: runtime.env.CASH_APP_MERCHANT_ID,
          grant_id: runtime.env.CASH_APP_GRANT_ID,
          purpose: "SERVICES",
          capture: true,
          note: runtime.env.CASH_APP_PAYOUT_NOTE ?? "ADA off-ramp payout",
          reference_id: input.intentId,
          metadata: { intent_id: input.intentId },
        },
      }));
      const normalized = payoutStatus(result.payout.status);
      return {
        railTxRef: result.payout.payout_id,
        status: normalized === "FAILED" ? "REJECTED" : "ACCEPTED",
        providerStatus: normalized,
        providerReference: { id: result.payout.payout_id, idempotencyKey },
        raw: { provider: "cashapp", mode: "sandbox", providerState: result.payout.status },
      };
    },
    async getStatus(input) {
      assertConfigured("cashapp", missing);
      const result = await responseJson<CashAppPayoutResponse>("cashapp", await cashFetch(
        "GET",
        `/payouts/${encodeURIComponent(input.providerReference.id)}`,
      ));
      return {
        railTxRef: result.payout.payout_id,
        providerStatus: payoutStatus(result.payout.status),
        providerState: result.payout.status,
        observedAt: runtime.now(),
        raw: { provider: "cashapp", mode: "sandbox" },
      };
    },
    verifyWebhook(input) {
      assertConfigured("cashapp", missing);
      const supplied = header(input.headers, "x-signature") ?? "";
      const [version, suppliedHex] = supplied.split(" ");
      if (version !== "V1" || !suppliedHex) return { valid: false, reason: "Cash App webhook signature missing or unsupported" };
      const rawBody = bytes(input.rawBody).toString("utf8");
      const path = input.path ?? "/";
      const canonicalHeaders: Record<string, string> = {
        accept: header(input.headers, "accept") ?? "*/*",
        authorization: header(input.headers, "authorization") ?? authorization(),
        "content-type": header(input.headers, "content-type") ?? "application/json; charset=utf-8",
        host: header(input.headers, "host") ?? "",
      };
      const expected = signature("POST", path, rawBody, canonicalHeaders);
      if (!safeEqualHex(suppliedHex, expected)) return { valid: false, reason: "Cash App webhook signature mismatch" };
      try {
        const payload = JSON.parse(rawBody) as {
          event_id?: string;
          id?: string;
          payout?: CashAppPayout;
          data?: { payout?: CashAppPayout };
        };
        const payout = payload.payout ?? payload.data?.payout;
        return {
          valid: true,
          providerEventId: payload.event_id ?? payload.id,
          providerReferenceId: payout?.payout_id,
          providerState: payout?.status,
          providerStatus: payout?.status ? payoutStatus(payout.status) : undefined,
        };
      } catch {
        return { valid: false, reason: "Cash App webhook JSON invalid" };
      }
    },
  };
}

export const cashappAdapter = createCashAppAdapter();
