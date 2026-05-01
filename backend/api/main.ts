import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

import {
  OffRampSDK,
  createAppLucid,
  paymentPkhFromAddress,
  escrowScriptAddress,
  submitLockTx,
  submitReleaseTx,
  submitRefundTx,
  vkHash,
  operatorPublicKeyHex,
  adapters,
} from "../../sdk/src/index.ts";
import type { Currency, IntentRecord, RailId } from "../../sdk/src/types.ts";
import {
  appendError,
  getIntent,
  listIntents,
  loadReport,
  patchIntent,
  upsertIntent,
} from "./state.ts";
import { openApiSpec, swaggerHtml } from "./openapi.ts";

const PORT = Number(process.env.API_PORT ?? "8788");

// Stringify BigInts in JSON responses (intent records contain `escrowLovelace`).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

// ── Module-scope helpers ─────────────────────────────────────────────────
async function buildSdk(): Promise<{ sdk: OffRampSDK; senderAddr: string; senderPkh: string }> {
  const lucid = await createAppLucid("sender");
  const senderAddr = await lucid.wallet().address();
  const senderPkh = paymentPkhFromAddress(senderAddr);
  // Operator is the same wallet in this demo (single seed for end-to-end runs).
  const sdk = new OffRampSDK({ senderPkh, operatorPkh: senderPkh });
  return { sdk, senderAddr, senderPkh };
}

// ── Routes ───────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  const network = process.env.CARDANO_NETWORK ?? "Preprod";
  const escrowAddr = escrowScriptAddress(network as any);
  return c.json({
    ok: true,
    service: "midnightzk-offramp-sdk",
    version: "0.1.0",
    cardano: {
      backend: process.env.CARDANO_BACKEND ?? "blockfrost",
      network,
      escrowScriptAddress: escrowAddr,
    },
    midnight: { circuitId: "offramp:v1", vkHash: vkHash() },
    oracle: { publicKeyHex: operatorPublicKeyHex() },
    railAdapters: Object.keys(adapters),
    railAdapterMode: process.env.RAIL_ADAPTER_MODE ?? "mock",
  });
});

app.get("/docs", (c) => c.html(swaggerHtml("/api/openapi.json")));
app.get("/api/openapi.json", (c) => c.json(openApiSpec));

app.get("/api/adapters", (c) =>
  c.json({
    adapters: Object.keys(adapters),
    mode: process.env.RAIL_ADAPTER_MODE ?? "mock",
  }),
);

app.post("/api/offramp/initiate", async (c) => {
  try {
    const body = await c.req.json<{
      adapter: RailId;
      payeeHandle: string;
      amountAda: number;
      fiatAmount: string;
      fiatCurrency: Currency;
      jurisdiction?: string;
    }>();
    const { sdk, senderPkh } = await buildSdk();
    const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp(body);
    const record: IntentRecord = {
      ...body,
      intentId: initiate.intentId,
      status: "PENDING",
      initiate,
      quote: railQuote,
      errors: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertIntent(record);
    return c.json({ intent: record, payeeSalt, amountSalt, senderPkh });
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 400);
  }
});

app.post("/api/offramp/lock", async (c) => {
  const { intentId } = await c.req.json<{ intentId: string }>();
  const intent = getIntent(intentId);
  if (!intent) return c.json({ error: "intent not found" }, 404);
  try {
    const lucid = await createAppLucid("sender");
    const senderAddr = await lucid.wallet().address();
    const senderPkh = paymentPkhFromAddress(senderAddr);
    const operatorPkh = senderPkh; // single-seed demo
    const datum = {
      intentId: intent.initiate.intentId,
      payeeCommitment: intent.initiate.payeeCommitment,
      amountCommitment: intent.initiate.amountCommitment,
      adapterTag: intent.initiate.adapterTag,
      deadline: BigInt(intent.initiate.deadline) * 1000n, // POSIX ms for on-chain
      vkHash: intent.initiate.vkHash,
      senderPkh,
      operatorPkh,
    };
    const res = await submitLockTx(lucid, datum, intent.initiate.escrowLovelace);
    patchIntent(intentId, { status: "LOCKED", cardanoLockTx: res.txHash });
    return c.json({
      txHash: res.txHash,
      scriptAddress: res.scriptAddress,
      explorer: `https://${(process.env.CARDANO_NETWORK ?? "preprod").toLowerCase()}.cardanoscan.io/transaction/${res.txHash}`,
    });
  } catch (e) {
    appendError(intentId, "lock: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.post("/api/offramp/prove", async (c) => {
  const { intentId, payeeHandle, payeeSalt, amountSalt } = await c.req.json<{
    intentId: string;
    payeeHandle: string;
    payeeSalt: string;
    amountSalt: string;
  }>();
  const intent = getIntent(intentId);
  if (!intent || !intent.quote) return c.json({ error: "intent not found" }, 404);
  try {
    const { sdk } = await buildSdk();
    const proof = await sdk.generateZKProof({
      intentId,
      payeeHandle,
      payeeSalt,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
      railQuoteDigest: intent.quote.railQuoteDigest,
      principalLovelace: intent.initiate.escrowLovelace,
      amountSalt,
      adapterTag: intent.initiate.adapterTag,
    });
    const v = await sdk.verifyZKProof(proof, {
      payeeHandle,
      payeeSalt,
      fiatAmount: intent.fiatAmount,
      fiatCurrency: intent.fiatCurrency,
      railQuoteDigest: intent.quote.railQuoteDigest,
      principalLovelace: intent.initiate.escrowLovelace,
      amountSalt,
    });
    patchIntent(intentId, { status: "PROVED", proof });
    return c.json({ proof, verify: v });
  } catch (e) {
    appendError(intentId, "prove: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.post("/api/offramp/submit-payment", async (c) => {
  const { intentId, payeeHandle } = await c.req.json<{ intentId: string; payeeHandle: string }>();
  const intent = getIntent(intentId);
  if (!intent || !intent.proof || !intent.quote) return c.json({ error: "intent not proved" }, 400);
  try {
    const { sdk } = await buildSdk();
    const res = await sdk.submitPayment({
      adapter: intent.adapter,
      intentId,
      proof: intent.proof,
      payeeHandle,
      quote: intent.quote,
    });
    patchIntent(intentId, { status: "SUBMITTED", railTxRef: res.railTxRef });
    return c.json({ result: res });
  } catch (e) {
    appendError(intentId, "submit: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.post("/api/offramp/confirm-settlement", async (c) => {
  const { intentId, status } = await c.req.json<{
    intentId: string;
    status?: "SETTLED" | "FAILED";
  }>();
  const intent = getIntent(intentId);
  if (!intent || !intent.railTxRef) return c.json({ error: "intent not submitted" }, 400);
  try {
    const { sdk } = await buildSdk();
    const finalStatus = status ?? "SETTLED";
    const att = await sdk.confirmSettlement({
      intentId,
      railTxRef: intent.railTxRef,
      status: finalStatus,
    });
    patchIntent(intentId, {
      status: finalStatus === "SETTLED" ? "SETTLED" : "FAILED",
      oracle: att,
    });
    return c.json({ attestation: att });
  } catch (e) {
    appendError(intentId, "oracle: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.post("/api/offramp/release", async (c) => {
  const { intentId, lockTxHash, lockOutputIndex, payoutAddress } = await c.req.json<{
    intentId: string;
    lockTxHash?: string;
    lockOutputIndex?: number;
    payoutAddress?: string;
  }>();
  const intent = getIntent(intentId);
  if (!intent) return c.json({ error: "intent not found" }, 404);
  try {
    const lucid = await createAppLucid("operator");
    const operatorAddr = await lucid.wallet().address();
    const txHash = lockTxHash ?? intent.cardanoLockTx;
    if (!txHash) return c.json({ error: "no lock tx recorded for intent" }, 400);
    const res = await submitReleaseTx(
      lucid,
      { txHash, outputIndex: lockOutputIndex ?? 0 },
      payoutAddress ?? operatorAddr,
      intent.initiate.escrowLovelace - 1_000_000n, // minus an estimated fee buffer
    );
    patchIntent(intentId, { status: "RELEASED", cardanoReleaseTx: res.txHash });
    return c.json({
      txHash: res.txHash,
      explorer: `https://${(process.env.CARDANO_NETWORK ?? "preprod").toLowerCase()}.cardanoscan.io/transaction/${res.txHash}`,
    });
  } catch (e) {
    appendError(intentId, "release: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.post("/api/offramp/refund", async (c) => {
  const { intentId, lockTxHash, lockOutputIndex } = await c.req.json<{
    intentId: string;
    lockTxHash?: string;
    lockOutputIndex?: number;
  }>();
  const intent = getIntent(intentId);
  if (!intent) return c.json({ error: "intent not found" }, 404);
  try {
    const lucid = await createAppLucid("sender");
    const txHash = lockTxHash ?? intent.cardanoLockTx;
    if (!txHash) return c.json({ error: "no lock tx recorded for intent" }, 400);
    const res = await submitRefundTx(
      lucid,
      { txHash, outputIndex: lockOutputIndex ?? 0 },
      intent.initiate.escrowLovelace - 1_000_000n,
    );
    patchIntent(intentId, { status: "REFUNDED", cardanoRefundTx: res.txHash });
    return c.json({
      txHash: res.txHash,
      explorer: `https://${(process.env.CARDANO_NETWORK ?? "preprod").toLowerCase()}.cardanoscan.io/transaction/${res.txHash}`,
    });
  } catch (e) {
    appendError(intentId, "refund: " + (e as Error).message);
    return c.json({ error: String((e as Error).message) }, 500);
  }
});

app.get("/api/intents", (c) => c.json({ intents: listIntents() }));
app.get("/api/intents/:id", (c) => {
  const r = getIntent(c.req.param("id"));
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json({ intent: r });
});

app.get("/api/testnet-evidence", (c) => {
  // Returns a curated list of testnet evidence rows for the UI sidebar.
  // The authoritative document is `docs/testnet-evidence.md` in the repo.
  const items: { kind: string; txHash: string; explorer: string }[] = [];
  const evPath = new URL("../../docs/testnet-evidence.md", import.meta.url);
  try {
    const fs = require("node:fs");
    const text = fs.readFileSync(evPath, "utf8") as string;
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
      items.push({
        kind,
        txHash: h,
        explorer: `https://preprod.cardanoscan.io/transaction/${h}`,
      });
      if (items.length >= 8) break;
    }
  } catch {}
  return c.json({ items });
});

app.get("/api/testing-report", (c) => {
  const r = loadReport();
  if (!r) return c.json({ error: "no report yet; run /api/test/run-suite" }, 404);
  return c.json({ report: r });
});

app.post("/api/test/run-suite", async (c) => {
  const { runsPerRail = 10 } = await c.req.json<{ runsPerRail?: number }>().catch(() => ({ runsPerRail: 10 }));
  const { runInternalTestSuite } = await import("../../scripts/internal-test-lib.ts");
  const report = await runInternalTestSuite({ runsPerRail });
  return c.json({ report });
});

console.log(`offramp api listening on http://127.0.0.1:${PORT}`);
console.log(`  docs:    http://127.0.0.1:${PORT}/docs`);
console.log(`  openapi: http://127.0.0.1:${PORT}/api/openapi.json`);

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
