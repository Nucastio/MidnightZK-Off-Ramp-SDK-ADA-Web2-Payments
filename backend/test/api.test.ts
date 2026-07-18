/**
 * In-process integration tests for the off-ramp backend (Hono `app.request`).
 *
 * Run: node --import tsx --test backend/test/
 *
 * External effects are injected: Cardano is an in-memory fake, Midnight uses
 * the SDK's MockMidnightProofProvider, the rail adapter is the deterministic
 * mock with a controllable getStatus, and the oracle is the real module keyed
 * from test env vars.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Environment must be set before the modules under test are imported.
const DATA_DIR = mkdtempSync(join(tmpdir(), "offramp-api-test-"));
process.env.OFFRAMP_DATA_DIR = DATA_DIR;
process.env.OPERATOR_ED25519_SK_HEX = "8e3b1c5f0a7d2e94b6c81f3a05d49e2c7b16a8f0d4e5c3219b7f8a02e6d1c4f9";
process.env.RAIL_WEBHOOK_HMAC_KEY = "test-shared-hmac-key";
process.env.RAIL_ADAPTER_MODE = "mock";
process.env.ESCROW_DEADLINE_SECONDS = "900";

const { createApp } = await import("../api/app.ts");
const { OffRampSDK } = await import("../../sdk/src/sdk.ts");
const { MockMidnightProofProvider } = await import("../../sdk/src/testing/mock-midnight-proof-provider.ts");
const { createDeterministicMockAdapter } = await import("../../sdk/src/adapters/mock.ts");
const { attestSettlement, verifyAttestation, signReleaseAuthorization } =
  await import("../../sdk/src/oracle/settlement-oracle.ts");
import type { RailProviderStatus } from "../../sdk/src/types.ts";

// ── Test doubles ─────────────────────────────────────────────────────────

const SENDER_PKH = "ab".repeat(28);
const sdk = new OffRampSDK({
  senderPkh: SENDER_PKH,
  operatorPkh: SENDER_PKH,
  midnightProofProvider: new MockMidnightProofProvider(),
});

let providerStatus: RailProviderStatus = "SETTLED";
const baseAdapter = createDeterministicMockAdapter("cashapp");
const adapter = {
  ...baseAdapter,
  async getStatus(input: { intentId: string; providerReference: { id: string } }) {
    return {
      railTxRef: input.providerReference.id,
      providerStatus,
      providerState: providerStatus.toLowerCase(),
      observedAt: Date.now(),
    };
  },
};

const calls = { submitLock: 0, confirmLock: 0, submitRelease: 0, submitRefund: 0 };
let nowOffsetMs = 0;

const app = createApp({
  now: () => Date.now() + nowOffsetMs,
  allowedOrigins: ["https://allowed.example"],
  testEndpointsEnabled: false,
  buildSdk: async () => ({ sdk, senderPkh: SENDER_PKH }),
  getAdapter: () => adapter,
  healthInfo: () => ({ ok: true, service: "test" }),
  adaptersInfo: () => ({ adapters: ["cashapp"], mode: "mock" }),
  cardano: {
    async submitLock() {
      calls.submitLock += 1;
      return { txHash: "1a".repeat(32), scriptAddress: "addr_test1fakescript", outputIndex: 0 };
    },
    async confirmLock() {
      calls.confirmLock += 1;
      return { confirmed: true };
    },
    async buildReleaseAuthorizationMessage() {
      return "d8799f0102ff";
    },
    async submitRelease() {
      calls.submitRelease += 1;
      return { txHash: "2b".repeat(32) };
    },
    async submitRefund() {
      calls.submitRefund += 1;
      return { txHash: "3c".repeat(32) };
    },
  },
  oracle: {
    attest: attestSettlement,
    verifyAttestation,
    signReleaseAuthorization,
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────

interface ApiResponse {
  status: number;
  json: any;
  text: string;
  headers: Headers;
}

async function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.token) headers["x-capability-token"] = opts.token;
  const res = await app.request(path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

interface IntentCtx {
  intentId: string;
  token: string;
  payeeHandle: string;
  payeeSalt: string;
  amountSalt: string;
}

async function initiate(payeeHandle = "$alice"): Promise<IntentCtx> {
  const r = await req("/api/offramp/initiate", {
    body: { adapter: "cashapp", payeeHandle, amountAda: 2, fiatAmount: "1.50", fiatCurrency: "USD" },
  });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.capabilityToken, "capability token must be returned once at initiate");
  assert.ok(r.json.payeeSalt && r.json.amountSalt, "salts must be returned once at initiate");
  assert.equal(r.json.intent.state, "CREATED");
  assert.equal(r.json.intent.capabilityTokenHash, undefined, "token hash must not be exposed");
  return {
    intentId: r.json.intent.intentId,
    token: r.json.capabilityToken,
    payeeHandle,
    payeeSalt: r.json.payeeSalt,
    amountSalt: r.json.amountSalt,
  };
}

async function driveToPaymentSubmitted(ctx: IntentCtx): Promise<void> {
  let r = await req("/api/offramp/lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(r.status, 200, r.text);
  r = await req("/api/offramp/confirm-lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.state, "LOCK_CONFIRMED");
  r = await req("/api/offramp/prove", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle, payeeSalt: ctx.payeeSalt, amountSalt: ctx.amountSalt },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.state, "MIDNIGHT_INTENT_PROVED");
  r = await req("/api/offramp/submit-payment", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.state, "PAYMENT_SUBMITTED");
}

async function getDetail(ctx: IntentCtx): Promise<ApiResponse> {
  return req(`/api/intents/${ctx.intentId}`, { token: ctx.token });
}

// ── Tests ────────────────────────────────────────────────────────────────

test("unauthorized mutation fails (missing and wrong capability token)", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();

  const noToken = await req("/api/offramp/lock", { body: { intentId: ctx.intentId } });
  assert.equal(noToken.status, 401);

  const wrongToken = await req("/api/offramp/lock", {
    token: "f0".repeat(32),
    body: { intentId: ctx.intentId },
  });
  assert.equal(wrongToken.status, 401);

  const detailNoToken = await req(`/api/intents/${ctx.intentId}`);
  assert.equal(detailNoToken.status, 401, "detail read must require the capability token");

  // State must not have advanced.
  const detail = await getDetail(ctx);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.intent.state, "CREATED");

  const ok = await req("/api/offramp/lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(ok.status, 200, ok.text);
});

test("state-skip fails: prove and submit-payment refuse a CREATED intent", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();

  const prove = await req("/api/offramp/prove", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle, payeeSalt: ctx.payeeSalt, amountSalt: ctx.amountSalt },
  });
  assert.equal(prove.status, 409, prove.text);

  const submit = await req("/api/offramp/submit-payment", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle },
  });
  assert.equal(submit.status, 409, submit.text);

  const release = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(release.status, 409, release.text);

  const detail = await getDetail(ctx);
  assert.equal(detail.json.intent.state, "CREATED", "failed skips must not mutate state");
});

test("caller-asserted settlement is impossible; adapter status gates the oracle", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();
  await driveToPaymentSubmitted(ctx);

  // Any caller-supplied status field is rejected outright.
  const asserted = await req("/api/offramp/confirm-settlement", {
    token: ctx.token,
    body: { intentId: ctx.intentId, status: "SETTLED" },
  });
  assert.equal(asserted.status, 400, asserted.text);

  // Non-terminal provider status: the oracle must not attest.
  providerStatus = "PROCESSING";
  const pending = await req("/api/offramp/confirm-settlement", {
    token: ctx.token,
    body: { intentId: ctx.intentId },
  });
  assert.equal(pending.status, 409, pending.text);
  let detail = await getDetail(ctx);
  assert.equal(detail.json.intent.state, "PAYMENT_SUBMITTED");
  assert.equal(detail.json.intent.oracle, undefined, "no attestation may exist before terminal provider status");

  // Terminal SETTLED at the provider → attestation + Midnight settlement receipt.
  providerStatus = "SETTLED";
  const settled = await req("/api/offramp/confirm-settlement", {
    token: ctx.token,
    body: { intentId: ctx.intentId },
  });
  assert.equal(settled.status, 200, settled.text);
  assert.equal(settled.json.attestation.status, "SETTLED");
  assert.ok(settled.json.settlementReceipt.receiptHash);
  assert.equal(settled.json.state, "MIDNIGHT_SETTLEMENT_PROVED");
});

test("adapter FAILED status transitions to PAYMENT_FAILED with a FAILED attestation", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();
  await driveToPaymentSubmitted(ctx);

  providerStatus = "FAILED";
  const r = await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });
  providerStatus = "SETTLED";
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.attestation.status, "FAILED");
  assert.equal(r.json.state, "PAYMENT_FAILED");

  // Terminal for the payment leg: settlement cannot be re-confirmed as SETTLED.
  const again = await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(again.status, 200);
  assert.equal(again.json.idempotent, true);
  assert.equal(again.json.attestation.status, "FAILED");
});

test("idempotent repeat calls return stored results without re-executing effects", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();

  const lock1 = await req("/api/offramp/lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(lock1.status, 200, lock1.text);
  const locksAfterFirst = calls.submitLock;
  const lock2 = await req("/api/offramp/lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(lock2.status, 200);
  assert.equal(lock2.json.idempotent, true);
  assert.equal(lock2.json.txHash, lock1.json.txHash);
  assert.equal(calls.submitLock, locksAfterFirst, "repeat lock must not resubmit the tx");

  await req("/api/offramp/confirm-lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  const confirmAgain = await req("/api/offramp/confirm-lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(confirmAgain.json.idempotent, true);

  const prove1 = await req("/api/offramp/prove", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle, payeeSalt: ctx.payeeSalt, amountSalt: ctx.amountSalt },
  });
  assert.equal(prove1.status, 200, prove1.text);
  const prove2 = await req("/api/offramp/prove", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(prove2.status, 200);
  assert.equal(prove2.json.idempotent, true);
  assert.equal(prove2.json.proof.receiptHash, prove1.json.proof.receiptHash);

  const submit1 = await req("/api/offramp/submit-payment", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle },
  });
  assert.equal(submit1.status, 200, submit1.text);
  const submit2 = await req("/api/offramp/submit-payment", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(submit2.json.idempotent, true);
  assert.equal(submit2.json.result.railTxRef, submit1.json.result.railTxRef);

  providerStatus = "SETTLED";
  const settle1 = await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(settle1.status, 200, settle1.text);
  const settle2 = await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(settle2.json.idempotent, true);
  assert.equal(settle2.json.attestation.signature, settle1.json.attestation.signature);

  const release1 = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(release1.status, 200, release1.text);
  const releasesAfterFirst = calls.submitRelease;
  const release2 = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(release2.json.idempotent, true);
  assert.equal(release2.json.txHash, release1.json.txHash);
  assert.equal(calls.submitRelease, releasesAfterFirst, "repeat release must not resubmit the tx");
});

test("release gating: requires settlement evidence, rejects overrides, follows RELEASE_AUTHORIZED → RELEASED", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();
  await driveToPaymentSubmitted(ctx);

  // Not settled yet → release refused.
  const early = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(early.status, 409, early.text);

  providerStatus = "SETTLED";
  const settled = await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(settled.status, 200, settled.text);

  // Caller-supplied overrides are rejected outright.
  for (const override of [
    { lockTxHash: "9d".repeat(32) },
    { lockOutputIndex: 3 },
    { payoutAddress: "addr_test1attacker" },
    { oracleSignature: "aa".repeat(64) },
  ]) {
    const r = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId, ...override } });
    assert.equal(r.status, 400, `override ${Object.keys(override)[0]} must be rejected: ${r.text}`);
  }

  const release = await req("/api/offramp/release", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(release.status, 200, release.text);
  assert.equal(release.json.state, "RELEASED");

  const detail = await getDetail(ctx);
  assert.equal(detail.json.intent.state, "RELEASED");
  const history = detail.json.intent.history.map((h: { to: string }) => h.to);
  assert.deepEqual(history, [
    "LOCK_SUBMITTED",
    "LOCK_CONFIRMED",
    "MIDNIGHT_INTENT_PROVED",
    "PAYMENT_SUBMITTED",
    "SETTLEMENT_CONFIRMED",
    "MIDNIGHT_SETTLEMENT_PROVED",
    "RELEASE_AUTHORIZED",
    "RELEASED",
  ]);
  assert.ok(detail.json.intent.releaseAuthorization.oracleSignature.length === 128, "oracle-signed release auth stored");

  // Refund after release is impossible.
  nowOffsetMs = 1_000_000;
  const refund = await req("/api/offramp/refund", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(refund.status, 409, refund.text);
  nowOffsetMs = 0;
});

test("refund: deadline enforced server-side, overrides rejected, then REFUNDED is terminal", async () => {
  nowOffsetMs = 0;
  const ctx = await initiate();
  await req("/api/offramp/lock", { token: ctx.token, body: { intentId: ctx.intentId } });
  await req("/api/offramp/confirm-lock", { token: ctx.token, body: { intentId: ctx.intentId } });

  const early = await req("/api/offramp/refund", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(early.status, 409, "refund before the deadline must fail");

  nowOffsetMs = 1_000_000; // beyond the 900s escrow deadline

  const override = await req("/api/offramp/refund", {
    token: ctx.token,
    body: { intentId: ctx.intentId, lockTxHash: "9d".repeat(32) },
  });
  assert.equal(override.status, 400, "lockTxHash override must be rejected");

  const refund = await req("/api/offramp/refund", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(refund.status, 200, refund.text);
  assert.equal(refund.json.state, "REFUNDED");

  const again = await req("/api/offramp/refund", { token: ctx.token, body: { intentId: ctx.intentId } });
  assert.equal(again.json.idempotent, true);

  const prove = await req("/api/offramp/prove", {
    token: ctx.token,
    body: { intentId: ctx.intentId, payeeHandle: ctx.payeeHandle, payeeSalt: ctx.payeeSalt, amountSalt: ctx.amountSalt },
  });
  assert.equal(prove.status, 409, "REFUNDED is terminal");
  nowOffsetMs = 0;
});

test("PII is absent from persisted state and from all read responses", async () => {
  nowOffsetMs = 0;
  const payeeHandle = "$pii-canary-cashtag";
  const ctx = await initiate(payeeHandle);
  await driveToPaymentSubmitted(ctx);
  providerStatus = "SETTLED";
  await req("/api/offramp/confirm-settlement", { token: ctx.token, body: { intentId: ctx.intentId } });

  const persisted = readFileSync(join(DATA_DIR, "intents.json"), "utf8");
  assert.ok(!persisted.includes(payeeHandle), "cleartext payeeHandle must never be persisted");
  assert.ok(!persisted.includes(ctx.payeeSalt), "payeeSalt must never be persisted");
  assert.ok(!persisted.includes(ctx.amountSalt), "amountSalt must never be persisted");
  assert.ok(!persisted.includes(ctx.token), "raw capability token must never be persisted");
  assert.ok(!persisted.includes("payeeHandle"), "payeeHandle key must be redacted from state.json");

  const detail = await getDetail(ctx);
  assert.equal(detail.status, 200);
  assert.ok(!detail.text.includes(payeeHandle));
  assert.ok(!detail.text.includes(ctx.payeeSalt));
  assert.ok(!detail.text.includes(ctx.amountSalt));
  assert.ok(!detail.text.includes(ctx.token));
  assert.ok(!detail.text.includes("capabilityTokenHash"), "token hash stays server-side");

  const list = await req("/api/intents");
  assert.equal(list.status, 200);
  assert.ok(!list.text.includes(payeeHandle));
  assert.ok(!list.text.includes(ctx.payeeSalt));
  assert.ok(!list.text.includes(ctx.token));
  // Summary rows only.
  const row = list.json.intents.find((i: { intentId: string }) => i.intentId === ctx.intentId);
  assert.deepEqual(Object.keys(row).sort(), ["adapter", "createdAt", "intentId", "state", "updatedAt"]);
});

test("test endpoints are disabled outside test mode", async () => {
  const report = await req("/api/testing-report");
  assert.equal(report.status, 403);
  const suite = await req("/api/test/run-suite", { body: { runsPerRail: 1 } });
  assert.equal(suite.status, 403);
});

test("CORS honors the env allowlist", async () => {
  const allowed = await app.request("/health", { headers: { origin: "https://allowed.example" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://allowed.example");

  const denied = await app.request("/health", { headers: { origin: "https://evil.example" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});
