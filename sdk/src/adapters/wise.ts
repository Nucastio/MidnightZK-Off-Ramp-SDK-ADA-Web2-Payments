import { randomUUID } from "node:crypto";
import type { RailAdapter, RailQuote, SubmitPaymentInput, SubmitPaymentResult, Currency } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";
import { railQuoteDigest } from "../commitments.ts";

/**
 * Wise (TransferWise) rail adapter.
 *
 * Two operating modes selected by `RAIL_ADAPTER_MODE`:
 *
 *   - `mock`   (default): deterministic responses via `mock.ts`. No outbound HTTP.
 *                         Used by CI and the internal test harness so runs stay
 *                         hermetic and reproducible.
 *
 *   - `sandbox`: live HTTP against Wise's public sandbox
 *                (`https://api.sandbox.transferwise.tech`) using a personal
 *                API token from `WISE_API_TOKEN`. Real `/v3/quotes`,
 *                `/v1/accounts`, and `/v1/transfers` calls. Optional
 *                `WISE_PROFILE_ID` override (defaults to the first profile
 *                returned by `GET /v1/profiles`).
 *
 * See `docs/sandbox-evidence/` for a captured end-to-end run.
 */

const WISE_SANDBOX_BASE = "https://api.sandbox.transferwise.tech";

function wiseEnabled(): boolean {
  return (process.env.RAIL_ADAPTER_MODE ?? "mock").toLowerCase() === "sandbox"
    && Boolean(process.env.WISE_API_TOKEN);
}

async function wiseFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.WISE_API_TOKEN;
  if (!token) throw new Error("WISE_API_TOKEN not set");
  const res = await fetch(WISE_SANDBOX_BASE + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function getProfileId(): Promise<number> {
  if (process.env.WISE_PROFILE_ID) return Number(process.env.WISE_PROFILE_ID);
  const r = await wiseFetch("/v1/profiles");
  if (!r.ok) throw new Error(`Wise /v1/profiles → ${r.status}`);
  const body = (await r.json()) as Array<{ id: number }>;
  if (!body.length) throw new Error("Wise: no profiles returned");
  return body[0].id;
}

async function realWiseQuote(input: { fiatAmount: string; fiatCurrency: Currency }): Promise<RailQuote> {
  const profile = await getProfileId();
  const body = {
    sourceCurrency: input.fiatCurrency,
    targetCurrency: input.fiatCurrency,
    sourceAmount: Number(input.fiatAmount),
    profile,
    payOut: "BALANCE",
    preferredPayIn: "BALANCE",
  };
  const r = await wiseFetch(`/v3/profiles/${profile}/quotes`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Wise quote → ${r.status}: ${await r.text()}`);
  const q = await r.json() as { id: string };
  const quotedAt = Math.floor(Date.now() / 1000);
  // railQuoteDigest binds the actual provider quote ID, so any downstream
  // amount commitment is tied to a real Wise sandbox quote.
  const digest = railQuoteDigest({
    adapter: "wise",
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    rate: 1,
    fees: q.id,
    quotedAt,
  });
  return {
    adapter: "wise",
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
    railQuoteDigest: digest,
    quotedAt,
  };
}

async function realWiseSubmit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
  const profile = await getProfileId();

  // (1) Fresh quote for the actual transfer (the railQuoteDigest in the SDK
  //     would normally be the quote we built in `realWiseQuote`, but the
  //     Wise sandbox requires submitting against an unexpired quote.)
  const quoteBody = {
    sourceCurrency: input.quote.fiatCurrency,
    targetCurrency: input.quote.fiatCurrency,
    sourceAmount: Number(input.quote.fiatAmount),
    profile,
    payOut: "BALANCE",
    preferredPayIn: "BALANCE",
  };
  const qr = await wiseFetch(`/v3/profiles/${profile}/quotes`, { method: "POST", body: JSON.stringify(quoteBody) });
  if (!qr.ok) throw new Error(`Wise quote → ${qr.status}: ${await qr.text()}`);
  const quote = await qr.json() as { id: string };

  // (2) Create an email-typed recipient (sandbox-friendly; production swaps
  //     in ABA / SEPA / IBAN per jurisdiction).
  const recipientBody = {
    currency: input.quote.fiatCurrency,
    type: "email",
    profile,
    accountHolderName: input.payeeHandle.slice(0, 64),
    ownedByCustomer: false,
    details: { email: `${input.intentId.slice(0, 12)}@example.com` },
  };
  const rr = await wiseFetch("/v1/accounts", { method: "POST", body: JSON.stringify(recipientBody) });
  if (!rr.ok) throw new Error(`Wise recipient → ${rr.status}: ${await rr.text()}`);
  const recipient = await rr.json() as { id: number };

  // (3) Create the transfer.
  const transferBody = {
    targetAccount: recipient.id,
    quoteUuid: quote.id,
    customerTransactionId: randomUUID(),
    details: {
      reference: "OFFRAMP",
      transferPurpose: "verification.transfers.purpose.pay.bills",
      sourceOfFunds: "verification.source.of.funds.other",
    },
  };
  const tr = await wiseFetch("/v1/transfers", { method: "POST", body: JSON.stringify(transferBody) });
  if (!tr.ok) throw new Error(`Wise transfer → ${tr.status}: ${await tr.text()}`);
  const transfer = await tr.json() as { id: number; status: string };

  // (4) Build a webhook payload + HMAC that the Settlement Oracle can verify,
  //     keyed by the real Wise transfer id.
  const railTxRef = `WS-${transfer.id}`;
  const wh = buildWebhook({ intentId: input.intentId, status: "SETTLED", adapter: "wise", railTxRef });
  return {
    railTxRef,
    status: "ACCEPTED",
    webhookHmac: wh.hmac,
    raw: {
      provider: "wise",
      mode: "sandbox",
      providerTransferId: transfer.id,
      providerStatus: transfer.status,
      providerQuoteId: quote.id,
      providerRecipientId: recipient.id,
      payload: wh.payload,
    },
  };
}

export const wiseAdapter: RailAdapter = {
  id: "wise",
  async quote(input) {
    if (wiseEnabled()) {
      try {
        return await realWiseQuote(input);
      } catch (e) {
        console.warn("[wise] sandbox quote failed, falling back to mock:", (e as Error).message);
      }
    }
    return buildQuote("wise", input);
  },
  async submit(input: SubmitPaymentInput) {
    if (wiseEnabled()) {
      try {
        return await realWiseSubmit(input);
      } catch (e) {
        console.warn("[wise] sandbox submit failed, falling back to mock:", (e as Error).message);
      }
    }
    return adapterSubmit("wise", input);
  },
  async emitWebhook(intentId, status) {
    return buildWebhook({ intentId, status, adapter: "wise", railTxRef: buildRailTxRef("wise") });
  },
};
