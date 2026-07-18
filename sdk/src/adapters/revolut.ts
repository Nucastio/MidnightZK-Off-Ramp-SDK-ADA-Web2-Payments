import { createHmac, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { railQuoteDigest } from "../commitments.js";
import type {
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
  normalizeTerminalStatus,
  responseJson,
  safeEqualHex,
  type AdapterDependencies,
} from "./common.js";
import { createDeterministicMockAdapter } from "./mock.js";

const REVOLUT_SANDBOX_BASE = "https://sandbox-b2b.revolut.com/api/1.0";
const CAPABILITIES: RailCapabilities = {
  providerQuote: false,
  idempotentSubmit: true,
  authenticatedStatus: true,
  webhookVerification: true,
  sandboxEvidenceDriver: true,
};

interface RevolutTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface RevolutCounterparty {
  id: string;
  name?: string;
  company_name?: string;
  accounts?: Array<{ id: string }>;
}

interface RevolutTransaction {
  id: string;
  state: string;
  request_id?: string;
}

function transactionStatus(state: string): RailProviderStatus {
  return normalizeTerminalStatus(state, ["completed"], ["declined", "failed", "reverted"], ["created"]);
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function loadPrivateKey(env: NodeJS.ProcessEnv): string | undefined {
  if (env.REVOLUT_PRIVATE_KEY_PEM) return env.REVOLUT_PRIVATE_KEY_PEM.replace(/\\n/g, "\n");
  if (env.REVOLUT_PRIVATE_KEY_PATH) return readFileSync(env.REVOLUT_PRIVATE_KEY_PATH, "utf8");
  return undefined;
}

export function createRevolutAdapter(deps: AdapterDependencies = {}): RailAdapter {
  const runtime = adapterRuntime(deps);
  if (runtime.mode === "mock") return createDeterministicMockAdapter("revolut", deps);

  const privateKey = loadPrivateKey(runtime.env);
  const hasBeneficiary = Boolean(runtime.env.REVOLUT_COUNTERPARTY_ID || runtime.env.REVOLUT_BENEFICIARY_JSON);
  const missing = [
    ...(!runtime.env.REVOLUT_CLIENT_ID ? ["REVOLUT_CLIENT_ID"] : []),
    ...(!privateKey ? ["REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH"] : []),
    ...(!runtime.env.REVOLUT_SOURCE_ACCOUNT_ID ? ["REVOLUT_SOURCE_ACCOUNT_ID"] : []),
    ...(!hasBeneficiary ? ["REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON"] : []),
    ...(!runtime.env.REVOLUT_REFRESH_TOKEN ? ["REVOLUT_REFRESH_TOKEN"] : []),
    ...(!runtime.env.REVOLUT_JWT_ISSUER ? ["REVOLUT_JWT_ISSUER"] : []),
  ];
  const baseUrl = runtime.env.REVOLUT_API_BASE_URL?.replace(/\/$/, "") || REVOLUT_SANDBOX_BASE;
  let tokenCache: { token: string; expiresAt: number } | undefined;

  function clientAssertion(): string {
    const now = Math.floor(runtime.now() / 1000);
    const headerPart = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payloadPart = base64Url(JSON.stringify({
      // Revolut requires `iss` to be the certificate's OAuth redirect-URI domain
      // (without scheme), not the client id — verified against the sandbox API.
      iss: runtime.env.REVOLUT_JWT_ISSUER,
      sub: runtime.env.REVOLUT_CLIENT_ID,
      aud: runtime.env.REVOLUT_JWT_AUDIENCE ?? "https://revolut.com",
      iat: now,
      exp: now + 300,
      jti: deterministicUuid("revolut-client-assertion", `${runtime.env.REVOLUT_CLIENT_ID}:${now}`),
    }));
    const unsigned = `${headerPart}.${payloadPart}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${base64Url(signer.sign(privateKey!))}`;
  }

  async function accessToken(): Promise<string> {
    assertConfigured("revolut", missing);
    if (tokenCache && tokenCache.expiresAt > runtime.now() + 30_000) return tokenCache.token;
    // Business API access tokens come from the refresh-token grant; the
    // authorization-code consent is a one-time portal step that yields the
    // long-lived refresh token supplied via REVOLUT_REFRESH_TOKEN.
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: runtime.env.REVOLUT_REFRESH_TOKEN!,
      client_id: runtime.env.REVOLUT_CLIENT_ID!,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: clientAssertion(),
    });
    const token = await responseJson<RevolutTokenResponse>("revolut", await fetchWithTimeout(runtime, `${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }));
    tokenCache = {
      token: token.access_token,
      expiresAt: runtime.now() + Math.max(60, token.expires_in ?? 240) * 1000,
    };
    return tokenCache.token;
  }

  async function revolutFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await accessToken();
    return fetchWithTimeout(runtime, `${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  async function beneficiary(): Promise<{ counterpartyId: string; accountId?: string }> {
    const configuredId = runtime.env.REVOLUT_COUNTERPARTY_ID;
    const configuredAccountId = runtime.env.REVOLUT_COUNTERPARTY_ACCOUNT_ID;
    if (configuredId && configuredAccountId) return { counterpartyId: configuredId, accountId: configuredAccountId };
    if (configuredId) {
      const existing = await responseJson<RevolutCounterparty>("revolut", await revolutFetch(
        `/counterparty/${encodeURIComponent(configuredId)}`,
      ));
      return { counterpartyId: configuredId, accountId: existing.accounts?.[0]?.id };
    }

    let request: Record<string, unknown>;
    try {
      request = JSON.parse(runtime.env.REVOLUT_BENEFICIARY_JSON!) as Record<string, unknown>;
    } catch {
      throw new Error("REVOLUT_BENEFICIARY_JSON must be valid JSON");
    }
    const name = String(request.name ?? request.company_name ?? "");
    if (name) {
      const existing = await responseJson<RevolutCounterparty[]>("revolut", await revolutFetch(
        `/counterparties?name=${encodeURIComponent(name)}`,
      ));
      const match = existing.find((entry) => entry.name === name || entry.company_name === name);
      if (match) return { counterpartyId: match.id, accountId: configuredAccountId ?? match.accounts?.[0]?.id };
    }
    const created = await responseJson<RevolutCounterparty>("revolut", await revolutFetch("/counterparty", {
      method: "POST",
      body: JSON.stringify(request),
    }));
    return { counterpartyId: created.id, accountId: configuredAccountId ?? created.accounts?.[0]?.id };
  }

  async function retrieveByRequestId(requestId: string): Promise<RevolutTransaction | undefined> {
    try {
      const response = await revolutFetch(`/transaction/${encodeURIComponent(requestId)}?id_type=request_id`);
      if (!response.ok) return undefined;
      return await response.json() as RevolutTransaction;
    } catch {
      return undefined;
    }
  }

  async function runEvidenceDriver(transactionId: string): Promise<void> {
    const action = (runtime.env.REVOLUT_EVIDENCE_ACTION ?? "none").toLowerCase();
    if (action === "none" || action === "") return;
    if (!["complete", "revert", "decline", "fail"].includes(action)) {
      throw new Error("REVOLUT_EVIDENCE_ACTION must be none, complete, revert, decline, or fail");
    }
    await responseJson("revolut", await revolutFetch(
      `/sandbox/transactions/${encodeURIComponent(transactionId)}/${action}`,
      { method: "POST" },
    ));
  }

  return {
    id: "revolut",
    mode: "sandbox",
    capabilities: CAPABILITIES,
    health: () => adapterHealth({ adapter: "revolut", mode: "sandbox", missing, capabilities: CAPABILITIES }),
    async quote(input) {
      assertConfigured("revolut", missing);
      const quotedAt = Math.floor(runtime.now() / 1000);
      const rate = "1";
      const fees = "0";
      return {
        adapter: "revolut",
        fiatAmount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
        railQuoteDigest: railQuoteDigest({
          adapter: "revolut",
          fiatAmount: input.fiatAmount,
          fiatCurrency: input.fiatCurrency,
          rate: 1,
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
      assertConfigured("revolut", missing);
      const requestId = deterministicUuid("revolut-payment", input.intentId);
      const receiver = await beneficiary();
      const paymentBody = {
        request_id: requestId,
        account_id: runtime.env.REVOLUT_SOURCE_ACCOUNT_ID,
        receiver: {
          counterparty_id: receiver.counterpartyId,
          ...(receiver.accountId ? { account_id: receiver.accountId } : {}),
        },
        amount: Number(input.quote.fiatAmount),
        currency: input.quote.fiatCurrency,
        reference: `OFFRAMP-${input.intentId.slice(0, 12)}`,
      };
      let transaction: RevolutTransaction | undefined;
      let originalError: unknown;
      try {
        transaction = await responseJson<RevolutTransaction>("revolut", await revolutFetch("/pay", {
          method: "POST",
          body: JSON.stringify(paymentBody),
        }));
      } catch (error) {
        originalError = error;
        transaction = await retrieveByRequestId(requestId);
      }
      if (!transaction) throw originalError instanceof Error ? originalError : new Error("Revolut payment submission failed");
      await runEvidenceDriver(transaction.id);
      const normalized = transactionStatus(transaction.state);
      return {
        railTxRef: transaction.id,
        status: normalized === "FAILED" ? "REJECTED" : "ACCEPTED",
        providerStatus: normalized,
        providerReference: {
          id: transaction.id,
          idempotencyKey: requestId,
          recipientId: receiver.counterpartyId,
        },
        raw: { provider: "revolut", mode: "sandbox", providerState: transaction.state },
      };
    },
    async getStatus(input) {
      assertConfigured("revolut", missing);
      const transaction = await responseJson<RevolutTransaction>("revolut", await revolutFetch(
        `/transaction/${encodeURIComponent(input.providerReference.id)}`,
      ));
      return {
        railTxRef: transaction.id,
        providerStatus: transactionStatus(transaction.state),
        providerState: transaction.state,
        observedAt: runtime.now(),
        raw: { provider: "revolut", mode: "sandbox" },
      };
    },
    verifyWebhook(input) {
      const secret = runtime.env.REVOLUT_WEBHOOK_SIGNING_SECRET;
      if (!secret) return { valid: false, reason: "REVOLUT_WEBHOOK_SIGNING_SECRET is not configured" };
      const timestamp = header(input.headers, "revolut-request-timestamp");
      const supplied = header(input.headers, "revolut-signature") ?? header(input.headers, "x-revolut-signature");
      if (!timestamp || !supplied) return { valid: false, reason: "Revolut webhook signature headers missing" };
      const timestampMs = Number(timestamp);
      const maxAgeMs = Number(runtime.env.REVOLUT_WEBHOOK_MAX_AGE_MS ?? "300000");
      if (!Number.isFinite(timestampMs) || Math.abs(runtime.now() - timestampMs) > maxAgeMs) {
        return { valid: false, reason: "Revolut webhook timestamp outside allowed window" };
      }
      const rawBody = bytes(input.rawBody).toString("utf8");
      const expected = createHmac("sha256", secret).update(`v1.${timestamp}.${rawBody}`).digest("hex");
      const matches = supplied.split(",").some((candidate) => {
        const [version, signatureHex] = candidate.trim().split("=");
        return version === "v1" && Boolean(signatureHex) && safeEqualHex(signatureHex, expected);
      });
      if (!matches) return { valid: false, reason: "Revolut webhook signature mismatch" };
      try {
        const payload = JSON.parse(rawBody) as {
          id?: string;
          event?: string;
          timestamp?: string;
          data?: { id?: string; state?: string; new_state?: string };
        };
        const state = payload.data?.state ?? payload.data?.new_state;
        return {
          valid: true,
          providerEventId: payload.id,
          providerReferenceId: payload.data?.id,
          providerState: state,
          providerStatus: state ? transactionStatus(state) : undefined,
        };
      } catch {
        return { valid: false, reason: "Revolut webhook JSON invalid" };
      }
    },
  };
}

export const revolutAdapter = createRevolutAdapter();
