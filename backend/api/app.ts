/**
 * Off-ramp backend HTTP app (Hono).
 *
 * All external effects (Cardano txs, Midnight proofs, rail adapters, oracle)
 * are injected through `AppDeps` so the app can be exercised in-process by
 * integration tests. `backend/api/main.ts` wires the production dependencies.
 *
 * Security model:
 *  - Per-intent capability token: returned exactly once by /api/offramp/initiate;
 *    only its SHA-256 hash is persisted. Every mutation and the intent-detail
 *    read require it.
 *  - Explicit lifecycle state machine; every mutation validates the source
 *    state and is idempotent on replay.
 *  - Settlement status is never accepted from the caller: it is observed from
 *    the rail adapter (authenticated getStatus or verified provider webhook)
 *    and only then attested by the oracle.
 *  - Release/refund use only the stored lock UTxO reference and datum-bound
 *    destinations; caller-supplied overrides are rejected.
 *  - CORS is restricted to an env-configured allowlist.
 */
import { readFileSync } from "node:fs";
import { timingSafeEqual, createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import type {
  Currency,
  IntentParams,
  InitiateOffRampResult,
  MidnightIntentReceipt,
  MidnightSettlementReceipt,
  OracleAttestation,
  RailAdapter,
  RailId,
  RailQuote,
  SubmitPaymentResult,
} from "../../sdk/src/types.ts";
import {
  LifecycleError,
  atOrAfter,
  capabilityTokenMatches,
  hashCapabilityToken,
  intentDetailView,
  intentSummaryView,
  newCapabilityToken,
  type StoredIntentRecord,
} from "./lifecycle.ts";
import {
  appendError,
  getIntent,
  listIntents,
  loadReport,
  patchIntent,
  transitionIntent,
  upsertIntent,
} from "./state.ts";
import { openApiSpec, swaggerHtml } from "./openapi.ts";

// Stringify BigInts in JSON responses (intent records contain `escrowLovelace`).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// ── Dependency ports ─────────────────────────────────────────────────────

export interface SdkPort {
  initiateOffRamp(params: IntentParams): Promise<{
    initiate: InitiateOffRampResult;
    payeeSalt: string;
    amountSalt: string;
    railQuote: RailQuote;
  }>;
  generateZKProof(input: {
    intentId: string;
    cardanoLockAnchor: { txHash: string; outputIndex: number };
    payeeHandle: string;
    payeeSalt: string;
    fiatAmount: string;
    fiatCurrency: Currency;
    railQuoteDigest: string;
    principalLovelace: bigint;
    amountSalt: string;
    payeeCommitment: string;
    amountCommitment: string;
    adapterTag: string;
    contractAddress?: string;
    priorReceipt?: MidnightIntentReceipt;
  }): Promise<MidnightIntentReceipt>;
  verifyZKProof(
    proof: MidnightIntentReceipt,
    expected: {
      intentId: string;
      cardanoLockAnchor: { txHash: string; outputIndex: number };
      payeeCommitment: string;
      amountCommitment: string;
      adapterTag: string;
    },
  ): Promise<unknown>;
  generateSettlementReceipt(input: {
    intentReceipt: MidnightIntentReceipt;
    settlementDigest: string;
  }): Promise<MidnightSettlementReceipt>;
  verifySettlementReceipt(
    receipt: MidnightSettlementReceipt,
    expected: {
      intentId: string;
      intentReceiptHash: string;
      settlementDigest: string;
      contractAddress?: string;
    },
  ): Promise<unknown>;
}

export interface EscrowOutRefLike {
  txHash: string;
  outputIndex: number;
}

export interface CardanoPort {
  submitLock(rec: StoredIntentRecord): Promise<{ txHash: string; scriptAddress: string; outputIndex: number }>;
  confirmLock(outRef: EscrowOutRefLike, intentId: string): Promise<{ confirmed: boolean; reason?: string }>;
  buildReleaseAuthorizationMessage(
    outRef: EscrowOutRefLike,
    body: { settlementDigest: string; midnightSettlementReceiptHash: string; authorizationExpiry: bigint },
  ): Promise<string>;
  submitRelease(
    outRef: EscrowOutRefLike,
    auth: {
      settlementDigest: string;
      midnightSettlementReceiptHash: string;
      authorizationExpiry: bigint;
      oracleSignature: string;
    },
  ): Promise<{ txHash: string }>;
  submitRefund(outRef: EscrowOutRefLike): Promise<{ txHash: string }>;
}

export interface OraclePort {
  attest(input: { intentId: string; railTxRef: string; status: "SETTLED" | "FAILED" }): OracleAttestation;
  verifyAttestation(att: OracleAttestation): boolean;
  signReleaseAuthorization(authorizationMessageCborHex: string): string;
}

export interface AppDeps {
  now?: () => number;
  /** Origins allowed by CORS. Empty list ⇒ no cross-origin browser access. */
  allowedOrigins: string[];
  testEndpointsEnabled: boolean;
  testEndpointToken?: string;
  releaseAuthWindowMs?: number;
  buildSdk(): Promise<{ sdk: SdkPort; senderPkh: string }>;
  getAdapter(id: RailId): RailAdapter;
  healthInfo(): Record<string, unknown>;
  adaptersInfo(): Record<string, unknown>;
  cardano: CardanoPort;
  oracle: OraclePort;
  runTestSuite?(runsPerRail: number): Promise<unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function presentedToken(c: Context): string | undefined {
  const direct = c.req.header("x-capability-token");
  if (direct?.trim()) return direct.trim();
  const auth = c.req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return undefined;
}

function requireIntentId(body: Record<string, unknown>): string {
  const id = body.intentId;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/i.test(id)) {
    throw new ApiError(400, "intentId must be a 64-hex string");
  }
  return id.toLowerCase();
}

function authorizedIntent(c: Context, intentId: string): StoredIntentRecord {
  const rec = getIntent(intentId);
  if (!rec) throw new ApiError(404, "intent not found");
  if (!capabilityTokenMatches(presentedToken(c), rec.capabilityTokenHash)) {
    throw new ApiError(401, "missing or invalid capability token for this intent");
  }
  return rec;
}

function rejectKeys(body: Record<string, unknown>, keys: string[], reason: string): void {
  for (const key of keys) {
    if (key in body) throw new ApiError(400, `\`${key}\` is not accepted: ${reason}`);
  }
}

function storedOutRef(rec: StoredIntentRecord): EscrowOutRefLike {
  if (!rec.cardanoLockTx) throw new ApiError(409, "no lock transaction recorded for this intent");
  return { txHash: rec.cardanoLockTx, outputIndex: rec.lockOutputIndex ?? 0 };
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => {
    throw new ApiError(400, "request body must be valid JSON");
  });
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "request body must be a JSON object");
  }
  return body;
}

function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

type Handler = (c: Context) => Promise<Response> | Response;

function handle(fn: Handler): Handler {
  return async (c) => {
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof ApiError) return c.json({ error: e.message }, e.status as 400);
      if (e instanceof LifecycleError) return c.json({ error: e.message }, e.httpStatus as 409);
      return c.json({ error: String((e as Error).message) }, 500);
    }
  };
}

const CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP"];

// ── App factory ──────────────────────────────────────────────────────────

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? Date.now;
  const releaseAuthWindowMs = deps.releaseAuthWindowMs ?? 10 * 60 * 1000;
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Capability-Token", "X-Test-Token"],
    }),
  );

  // ── System ─────────────────────────────────────────────────────────────
  app.get("/health", handle(async (c) => c.json(deps.healthInfo())));
  app.get("/docs", (c) => c.html(swaggerHtml("/api/openapi.json")));
  app.get("/api/openapi.json", (c) => c.json(openApiSpec));
  app.get("/api/adapters", handle(async (c) => c.json(deps.adaptersInfo())));

  // ── Initiate (CREATED) ─────────────────────────────────────────────────
  app.post("/api/offramp/initiate", handle(async (c) => {
    const body = await jsonBody(c);
    const adapter = body.adapter;
    if (typeof adapter !== "string") throw new ApiError(400, "adapter is required");
    const payeeHandle = body.payeeHandle;
    if (typeof payeeHandle !== "string" || payeeHandle.trim().length === 0) {
      throw new ApiError(400, "payeeHandle is required");
    }
    const amountAda = Number(body.amountAda);
    if (!Number.isFinite(amountAda) || amountAda <= 0) throw new ApiError(400, "amountAda must be > 0");
    const fiatAmount = body.fiatAmount;
    if (typeof fiatAmount !== "string" || !/^\d+(\.\d+)?$/.test(fiatAmount)) {
      throw new ApiError(400, "fiatAmount must be a decimal string");
    }
    const fiatCurrency = body.fiatCurrency;
    if (typeof fiatCurrency !== "string" || !CURRENCIES.includes(fiatCurrency as Currency)) {
      throw new ApiError(400, `fiatCurrency must be one of ${CURRENCIES.join(", ")}`);
    }
    try {
      deps.getAdapter(adapter as RailId);
    } catch {
      throw new ApiError(400, `unknown rail adapter: ${adapter}`);
    }

    const { sdk, senderPkh } = await deps.buildSdk();
    const params: IntentParams = {
      adapter: adapter as RailId,
      payeeHandle,
      amountAda,
      fiatAmount,
      fiatCurrency: fiatCurrency as Currency,
      ...(typeof body.jurisdiction === "string" ? { jurisdiction: body.jurisdiction } : {}),
    };
    const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp(params);

    const capabilityToken = newCapabilityToken();
    const createdAt = now();
    const record: StoredIntentRecord = {
      intentId: initiate.intentId,
      state: "CREATED",
      adapter: params.adapter,
      amountAda,
      fiatAmount,
      fiatCurrency: params.fiatCurrency,
      capabilityTokenHash: hashCapabilityToken(capabilityToken),
      initiate: {
        intentId: initiate.intentId,
        payeeCommitment: initiate.payeeCommitment,
        amountCommitment: initiate.amountCommitment,
        adapterTag: initiate.adapterTag,
        deadline: initiate.deadline,
        vkHash: initiate.vkHash,
        escrowLovelace: initiate.escrowLovelace,
      },
      quote: railQuote,
      history: [],
      errors: [],
      createdAt,
      updatedAt: createdAt,
    };
    upsertIntent(record);
    // The capability token and the two salts are returned exactly once, here.
    // None of them are persisted; the client must keep them in private state.
    return c.json({
      intent: intentDetailView(record),
      capabilityToken,
      payeeSalt,
      amountSalt,
      senderPkh,
    });
  }));

  // ── Lock (CREATED → LOCK_SUBMITTED) ────────────────────────────────────
  app.post("/api/offramp/lock", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    if (rec.cardanoLockTx && atOrAfter(rec.state, "LOCK_SUBMITTED")) {
      return c.json({ txHash: rec.cardanoLockTx, scriptAddress: rec.scriptAddress, state: rec.state, idempotent: true });
    }
    if (rec.state !== "CREATED") {
      throw new LifecycleError(`lock requires state CREATED (current: ${rec.state})`);
    }
    try {
      const res = await deps.cardano.submitLock(rec);
      const updated = transitionIntent(intentId, "LOCK_SUBMITTED", {
        cardanoLockTx: res.txHash,
        lockOutputIndex: res.outputIndex,
        scriptAddress: res.scriptAddress,
      });
      return c.json({ txHash: res.txHash, scriptAddress: res.scriptAddress, state: updated.state });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "lock: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Confirm lock (LOCK_SUBMITTED → LOCK_CONFIRMED) ─────────────────────
  app.post("/api/offramp/confirm-lock", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    if (atOrAfter(rec.state, "LOCK_CONFIRMED")) {
      return c.json({ txHash: rec.cardanoLockTx, state: rec.state, idempotent: true });
    }
    if (rec.state !== "LOCK_SUBMITTED") {
      throw new LifecycleError(`confirm-lock requires state LOCK_SUBMITTED (current: ${rec.state})`);
    }
    const outRef = storedOutRef(rec);
    const res = await deps.cardano.confirmLock(outRef, intentId);
    if (!res.confirmed) {
      throw new ApiError(409, `lock UTxO not confirmed on-chain yet${res.reason ? `: ${res.reason}` : ""}`);
    }
    const updated = transitionIntent(intentId, "LOCK_CONFIRMED", {});
    return c.json({ txHash: rec.cardanoLockTx, state: updated.state });
  }));

  // ── Prove (LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED) ────────────────────
  app.post("/api/offramp/prove", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    if (rec.proof && atOrAfter(rec.state, "MIDNIGHT_INTENT_PROVED")) {
      return c.json({ proof: rec.proof, state: rec.state, idempotent: true });
    }
    if (rec.state !== "LOCK_CONFIRMED") {
      throw new LifecycleError(`prove requires state LOCK_CONFIRMED (current: ${rec.state})`);
    }
    const { payeeHandle, payeeSalt, amountSalt } = body as {
      payeeHandle?: string;
      payeeSalt?: string;
      amountSalt?: string;
    };
    if (!payeeHandle || !payeeSalt || !amountSalt) {
      throw new ApiError(400, "payeeHandle, payeeSalt, and amountSalt are required (client-held witnesses)");
    }
    if (!rec.quote) throw new ApiError(409, "intent has no stored rail quote");
    const outRef = storedOutRef(rec);
    try {
      const { sdk } = await deps.buildSdk();
      const proof = await sdk.generateZKProof({
        intentId,
        cardanoLockAnchor: outRef,
        payeeHandle,
        payeeSalt,
        fiatAmount: rec.fiatAmount,
        fiatCurrency: rec.fiatCurrency,
        railQuoteDigest: rec.quote.railQuoteDigest,
        principalLovelace: BigInt(rec.initiate.escrowLovelace),
        amountSalt,
        payeeCommitment: rec.initiate.payeeCommitment,
        amountCommitment: rec.initiate.amountCommitment,
        adapterTag: rec.initiate.adapterTag,
        contractAddress: rec.midnightContractAddress,
        priorReceipt: rec.proof,
      });
      const verify = await sdk.verifyZKProof(proof, {
        intentId,
        cardanoLockAnchor: outRef,
        payeeCommitment: rec.initiate.payeeCommitment,
        amountCommitment: rec.initiate.amountCommitment,
        adapterTag: rec.initiate.adapterTag,
      });
      const updated = transitionIntent(intentId, "MIDNIGHT_INTENT_PROVED", {
        proof,
        midnightContractAddress: proof.contractAddress,
      });
      return c.json({ proof, verify, state: updated.state });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "prove: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Submit payment (MIDNIGHT_INTENT_PROVED → PAYMENT_SUBMITTED | PAYMENT_FAILED) ──
  app.post("/api/offramp/submit-payment", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    if (rec.railTxRef && atOrAfter(rec.state, "PAYMENT_SUBMITTED")) {
      return c.json({
        result: { railTxRef: rec.railTxRef, status: "ACCEPTED", providerStatus: rec.providerStatus },
        state: rec.state,
        idempotent: true,
      });
    }
    if (rec.state !== "MIDNIGHT_INTENT_PROVED") {
      throw new LifecycleError(`submit-payment requires state MIDNIGHT_INTENT_PROVED (current: ${rec.state})`);
    }
    const payeeHandle = body.payeeHandle;
    if (typeof payeeHandle !== "string" || payeeHandle.trim().length === 0) {
      throw new ApiError(400, "payeeHandle is required (client-held; never persisted)");
    }
    if (!rec.proof || !rec.quote) throw new ApiError(409, "intent is missing proof or quote");
    try {
      const adapter = deps.getAdapter(rec.adapter);
      const res: SubmitPaymentResult = await adapter.submit({
        intentId,
        proof: rec.proof,
        payeeHandle,
        quote: rec.quote,
      });
      if (res.status === "REJECTED") {
        transitionIntent(intentId, "PAYMENT_FAILED", {
          railTxRef: res.railTxRef,
          providerReference: res.providerReference,
          providerStatus: res.providerStatus,
          providerStatusObservedAt: now(),
        });
        throw new ApiError(502, `rail adapter rejected the submission (${rec.adapter})`);
      }
      const updated = transitionIntent(intentId, "PAYMENT_SUBMITTED", {
        railTxRef: res.railTxRef,
        providerReference: res.providerReference,
        providerStatus: res.providerStatus,
        providerStatusObservedAt: now(),
      });
      return c.json({
        result: { railTxRef: res.railTxRef, status: res.status, providerStatus: res.providerStatus },
        state: updated.state,
      });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "submit: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Confirm settlement (PAYMENT_SUBMITTED → SETTLEMENT_CONFIRMED → MIDNIGHT_SETTLEMENT_PROVED | PAYMENT_FAILED) ──
  app.post("/api/offramp/confirm-settlement", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    // Settlement status can never be asserted by the caller.
    rejectKeys(
      body,
      ["status", "settled", "providerStatus", "railTxRef", "settlementDigest"],
      "settlement status is obtained from the rail adapter, not the caller",
    );

    if (rec.state === "PAYMENT_FAILED" && rec.oracle) {
      return c.json({ attestation: rec.oracle, state: rec.state, idempotent: true });
    }
    if (atOrAfter(rec.state, "MIDNIGHT_SETTLEMENT_PROVED") && rec.oracle && rec.settlementReceipt) {
      return c.json({ attestation: rec.oracle, settlementReceipt: rec.settlementReceipt, state: rec.state, idempotent: true });
    }
    if (rec.state !== "PAYMENT_SUBMITTED" && rec.state !== "SETTLEMENT_CONFIRMED") {
      throw new LifecycleError(`confirm-settlement requires state PAYMENT_SUBMITTED (current: ${rec.state})`);
    }
    if (!rec.railTxRef || !rec.providerReference) throw new ApiError(409, "intent has no submitted payment");
    if (!rec.proof) throw new ApiError(409, "Midnight intent receipt required before settlement");

    try {
      const adapter = deps.getAdapter(rec.adapter);

      // Resume path: oracle already attested, only the Midnight settlement receipt is missing.
      let attestation = rec.state === "SETTLEMENT_CONFIRMED" ? rec.oracle : undefined;

      if (!attestation) {
        // Obtain the provider status via the adapter boundary only.
        let providerStatus: string | undefined;
        const webhook = body.webhook as { rawBody?: unknown; headers?: unknown } | undefined;
        if (webhook) {
          if (typeof webhook.rawBody !== "string" || webhook.headers === null || typeof webhook.headers !== "object") {
            throw new ApiError(400, "webhook must be { rawBody: string, headers: object }");
          }
          const verdict = adapter.verifyWebhook({
            rawBody: webhook.rawBody,
            headers: webhook.headers as Record<string, string | undefined>,
          });
          if (!verdict.valid) throw new ApiError(400, `webhook verification failed: ${verdict.reason ?? "invalid"}`);
          if (verdict.providerReferenceId && verdict.providerReferenceId !== rec.railTxRef) {
            throw new ApiError(400, "webhook references a different payment");
          }
          providerStatus = verdict.providerStatus;
        } else {
          const observation = await adapter.getStatus({ intentId, providerReference: rec.providerReference });
          providerStatus = observation.providerStatus;
        }

        if (providerStatus === "FAILED") {
          const att = deps.oracle.attest({ intentId, railTxRef: rec.railTxRef, status: "FAILED" });
          if (!deps.oracle.verifyAttestation(att)) throw new ApiError(500, "oracle attestation self-verify failed");
          const updated = transitionIntent(intentId, "PAYMENT_FAILED", {
            oracle: att,
            providerStatus: "FAILED",
            providerStatusObservedAt: now(),
          });
          return c.json({ attestation: att, state: updated.state });
        }
        if (providerStatus !== "SETTLED") {
          throw new ApiError(409, `settlement is not final at the provider (status: ${providerStatus ?? "unknown"})`);
        }

        attestation = deps.oracle.attest({ intentId, railTxRef: rec.railTxRef, status: "SETTLED" });
        if (!deps.oracle.verifyAttestation(attestation)) {
          throw new ApiError(500, "oracle attestation self-verify failed");
        }
        transitionIntent(intentId, "SETTLEMENT_CONFIRMED", {
          oracle: attestation,
          providerStatus: "SETTLED",
          providerStatusObservedAt: now(),
        });
      }
      if (!attestation) throw new ApiError(500, "missing oracle attestation");

      const { sdk } = await deps.buildSdk();
      const settlementReceipt = await sdk.generateSettlementReceipt({
        intentReceipt: rec.proof,
        settlementDigest: attestation.settlementDigest,
      });
      await sdk.verifySettlementReceipt(settlementReceipt, {
        intentId,
        intentReceiptHash: rec.proof.receiptHash,
        settlementDigest: attestation.settlementDigest,
        contractAddress: rec.proof.contractAddress,
      });
      const updated = transitionIntent(intentId, "MIDNIGHT_SETTLEMENT_PROVED", { settlementReceipt });
      return c.json({ attestation, settlementReceipt, state: updated.state });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "oracle: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Release (MIDNIGHT_SETTLEMENT_PROVED → RELEASE_AUTHORIZED → RELEASED) ──
  app.post("/api/offramp/release", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    rejectKeys(
      body,
      ["lockTxHash", "lockOutputIndex", "payoutAddress", "destination", "oracleSignature", "authorizationExpiry"],
      "release uses only the stored lock UTxO reference and datum-bound destinations",
    );

    if (rec.state === "RELEASED" && rec.cardanoReleaseTx) {
      return c.json({ txHash: rec.cardanoReleaseTx, state: rec.state, idempotent: true });
    }
    if (rec.state !== "MIDNIGHT_SETTLEMENT_PROVED" && rec.state !== "RELEASE_AUTHORIZED") {
      throw new LifecycleError(`release requires state MIDNIGHT_SETTLEMENT_PROVED (current: ${rec.state})`);
    }
    if (!rec.oracle || rec.oracle.status !== "SETTLED" || !deps.oracle.verifyAttestation(rec.oracle)) {
      throw new ApiError(409, "a valid SETTLED oracle attestation is required for release");
    }
    if (!rec.settlementReceipt) {
      throw new ApiError(409, "Midnight settlement receipt is required for release");
    }
    const outRef = storedOutRef(rec);
    const deadlineMs = rec.initiate.deadline * 1000;
    if (now() >= deadlineMs) {
      throw new ApiError(409, "escrow deadline has passed; only the refund path remains");
    }

    try {
      // Phase 1: build + sign the release authorization from stored facts only.
      let authorization = rec.state === "RELEASE_AUTHORIZED" ? rec.releaseAuthorization : undefined;
      const expiryStillValid =
        authorization && BigInt(authorization.authorizationExpiryMs) > BigInt(now() + 30_000);
      if (!authorization || !expiryStillValid) {
        const authorizationExpiry = BigInt(Math.min(deadlineMs, now() + releaseAuthWindowMs));
        const authorizationMessageCbor = await deps.cardano.buildReleaseAuthorizationMessage(outRef, {
          settlementDigest: rec.oracle.settlementDigest,
          midnightSettlementReceiptHash: rec.settlementReceipt.receiptHash,
          authorizationExpiry,
        });
        authorization = {
          authorizationMessageCbor,
          settlementDigest: rec.oracle.settlementDigest,
          midnightSettlementReceiptHash: rec.settlementReceipt.receiptHash,
          authorizationExpiryMs: authorizationExpiry.toString(),
          oracleSignature: deps.oracle.signReleaseAuthorization(authorizationMessageCbor),
        };
        if (rec.state === "MIDNIGHT_SETTLEMENT_PROVED") {
          transitionIntent(intentId, "RELEASE_AUTHORIZED", { releaseAuthorization: authorization });
        } else {
          patchIntent(intentId, { releaseAuthorization: authorization });
        }
      }

      // Phase 2: submit the release spending the stored lock UTxO.
      const res = await deps.cardano.submitRelease(outRef, {
        settlementDigest: authorization.settlementDigest,
        midnightSettlementReceiptHash: authorization.midnightSettlementReceiptHash,
        authorizationExpiry: BigInt(authorization.authorizationExpiryMs),
        oracleSignature: authorization.oracleSignature,
      });
      const updated = transitionIntent(intentId, "RELEASED", { cardanoReleaseTx: res.txHash });
      return c.json({ txHash: res.txHash, state: updated.state });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "release: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Refund (post-deadline recovery → REFUNDED) ─────────────────────────
  app.post("/api/offramp/refund", handle(async (c) => {
    const body = await jsonBody(c);
    const intentId = requireIntentId(body);
    const rec = authorizedIntent(c, intentId);
    rejectKeys(
      body,
      ["lockTxHash", "lockOutputIndex", "payoutAddress", "destination"],
      "refund uses only the stored lock UTxO reference and the datum-bound sender",
    );
    if (rec.state === "REFUNDED" && rec.cardanoRefundTx) {
      return c.json({ txHash: rec.cardanoRefundTx, state: rec.state, idempotent: true });
    }
    const REFUNDABLE = ["LOCK_SUBMITTED", "LOCK_CONFIRMED", "MIDNIGHT_INTENT_PROVED", "PAYMENT_SUBMITTED", "PAYMENT_FAILED"];
    if (!REFUNDABLE.includes(rec.state)) {
      throw new LifecycleError(`refund requires one of [${REFUNDABLE.join(", ")}] (current: ${rec.state})`);
    }
    const outRef = storedOutRef(rec);
    const deadlineMs = rec.initiate.deadline * 1000;
    if (now() < deadlineMs) {
      throw new ApiError(409, `refund is only available after the escrow deadline (${new Date(deadlineMs).toISOString()})`);
    }
    try {
      const res = await deps.cardano.submitRefund(outRef);
      const updated = transitionIntent(intentId, "REFUNDED", { cardanoRefundTx: res.txHash });
      return c.json({ txHash: res.txHash, state: updated.state });
    } catch (e) {
      if (e instanceof ApiError || e instanceof LifecycleError) throw e;
      appendError(intentId, "refund: " + (e as Error).message);
      throw e;
    }
  }));

  // ── Reads ──────────────────────────────────────────────────────────────
  app.get("/api/intents", (c) => c.json({ intents: listIntents().map(intentSummaryView) }));

  app.get("/api/intents/:id", handle(async (c) => {
    const rec = authorizedIntent(c, c.req.param("id") ?? "");
    return c.json({ intent: intentDetailView(rec) });
  }));

  app.get("/api/testnet-evidence", (c) => {
    // Curated list of testnet evidence rows for the UI sidebar; the
    // authoritative document is `docs/testnet-evidence.md`.
    const items: { kind: string; txHash: string; explorer: string }[] = [];
    try {
      const evPath = new URL("../../docs/testnet-evidence.md", import.meta.url);
      const text = readFileSync(evPath, "utf8");
      const rx = /\b([0-9a-f]{64})\b/gi;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = rx.exec(text))) {
        const h = m[1].toLowerCase();
        if (seen.has(h)) continue;
        seen.add(h);
        const idx = Math.max(0, m.index - 80);
        const ctx = text.slice(idx, m.index).toLowerCase();
        const kind = ctx.includes("refund") ? "REFUND"
          : ctx.includes("release") ? "RELEASE"
          : ctx.includes("lock") ? "LOCK"
          : ctx.includes("midnight") ? "Midnight"
          : "Tx";
        items.push({ kind, txHash: h, explorer: `https://preprod.cardanoscan.io/transaction/${h}` });
        if (items.length >= 8) break;
      }
    } catch {}
    return c.json({ items });
  });

  // ── Test endpoints (disabled outside test mode) ────────────────────────
  function requireTestAccess(c: Context): void {
    if (!deps.testEndpointsEnabled) {
      throw new ApiError(403, "test endpoints are disabled; set OFFRAMP_ENABLE_TEST_ENDPOINTS=1 to enable");
    }
    if (deps.testEndpointToken) {
      const presented = c.req.header("x-test-token") ?? "";
      if (!presented || !constantTimeEqual(presented, deps.testEndpointToken)) {
        throw new ApiError(401, "missing or invalid x-test-token");
      }
    }
  }

  app.get("/api/testing-report", handle(async (c) => {
    requireTestAccess(c);
    const r = loadReport();
    if (!r) return c.json({ error: "no report yet; run /api/test/run-suite" }, 404);
    return c.json({ report: r });
  }));

  app.post("/api/test/run-suite", handle(async (c) => {
    requireTestAccess(c);
    if (!deps.runTestSuite) throw new ApiError(503, "test suite runner is not wired in this deployment");
    const body = await c.req.json<{ runsPerRail?: number }>().catch(() => ({ runsPerRail: 10 }));
    const runsPerRail = Math.max(1, Math.min(50, Number(body.runsPerRail ?? 10)));
    const report = await deps.runTestSuite(runsPerRail);
    return c.json({ report });
  }));

  return app;
}
