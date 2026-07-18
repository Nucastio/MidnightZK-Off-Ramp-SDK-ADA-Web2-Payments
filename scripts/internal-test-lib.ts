/**
 * Internal Testing harness — generates acceptance evidence (success rate,
 * proof gen latency, per-rail breakdown).
 *
 * Runs N=runsPerRail simulated off-ramps per rail (Cash App, Wise, Revolut)
 * end-to-end through the SDK in-process. Measures per-step latency, computes
 * per-rail + overall success rate, and writes a report file.
 *
 * The Cardano LOCK / RELEASE steps are intentionally NOT submitted on-chain
 * here — those are exercised once in `scripts/preprod-lock.ts` with a real
 * Preprod tx, then referenced from the testnet-evidence document. Including
 * them in every test run would consume real ADA + Blockfrost quota.
 */
import { OffRampSDK } from "../sdk/src/index.ts";
import { MockMidnightProofProvider } from "../sdk/src/testing/mock-midnight-proof-provider.ts";
import type { Currency, RailId } from "../sdk/src/types.ts";
import { saveReport, type TestReportRecord } from "../backend/api/state.ts";

const SENDER_PKH = "00".repeat(28);
const OPERATOR_PKH = "11".repeat(28);

const RAILS: { adapter: RailId; payeeHandle: string; fiat: { amount: string; currency: Currency } }[] = [
  { adapter: "cashapp", payeeHandle: "$test_user_ca", fiat: { amount: "1.50", currency: "USD" } },
  { adapter: "wise", payeeHandle: "GB29NWBK60161331926819", fiat: { amount: "1.25", currency: "EUR" } },
  { adapter: "revolut", payeeHandle: "@test_user_rv", fiat: { amount: "1.00", currency: "GBP" } },
];

export interface RunResult {
  adapter: RailId;
  success: boolean;
  reason?: string;
  proveMs: number;
  verifyMs: number;
  submitMs: number;
  attestMs: number;
}

async function runOne(adapter: RailId, payeeHandle: string, fiat: { amount: string; currency: Currency }): Promise<RunResult> {
  const sdk = new OffRampSDK({
    senderPkh: SENDER_PKH,
    operatorPkh: OPERATOR_PKH,
    midnightProofProvider: new MockMidnightProofProvider(),
  });
  const t0 = performance.now();
  let proveMs = 0,
    verifyMs = 0,
    submitMs = 0,
    attestMs = 0;
  try {
    const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
      adapter,
      payeeHandle,
      amountAda: 2,
      fiatAmount: fiat.amount,
      fiatCurrency: fiat.currency,
    });
    const tProve = performance.now();
    const cardanoLockAnchor = { txHash: "aa".repeat(32), outputIndex: 0 };
    const proof = await sdk.generateZKProof({
      intentId: initiate.intentId,
      cardanoLockAnchor,
      payeeHandle,
      payeeSalt,
      fiatAmount: fiat.amount,
      fiatCurrency: fiat.currency,
      railQuoteDigest: railQuote.railQuoteDigest,
      principalLovelace: initiate.escrowLovelace,
      amountSalt,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
    });
    proveMs = performance.now() - tProve;
    const tVerify = performance.now();
    await sdk.verifyZKProof(proof, {
      intentId: initiate.intentId,
      cardanoLockAnchor,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
    });
    verifyMs = performance.now() - tVerify;
    const tSubmit = performance.now();
    const sub = await sdk.submitPayment({
      adapter,
      intentId: initiate.intentId,
      proof,
      payeeHandle,
      quote: railQuote,
    });
    submitMs = performance.now() - tSubmit;
    const tAttest = performance.now();
    await sdk.confirmSettlement({
      intentId: initiate.intentId,
      railTxRef: sub.railTxRef,
      status: "SETTLED",
    });
    attestMs = performance.now() - tAttest;
    return { adapter, success: true, proveMs, verifyMs, submitMs, attestMs };
  } catch (e) {
    return {
      adapter,
      success: false,
      reason: (e as Error).message,
      proveMs,
      verifyMs,
      submitMs,
      attestMs,
    };
  }
}

export async function runInternalTestSuite(opts: { runsPerRail?: number } = {}): Promise<TestReportRecord> {
  const runsPerRail = opts.runsPerRail ?? 10;
  const all: RunResult[] = [];
  for (const r of RAILS) {
    for (let i = 0; i < runsPerRail; i++) {
      const res = await runOne(r.adapter, `${r.payeeHandle}_${i}`, r.fiat);
      all.push(res);
    }
  }
  const perRail: TestReportRecord["perRail"] = {};
  for (const adapter of ["cashapp", "wise", "revolut"] as RailId[]) {
    const rows = all.filter((x) => x.adapter === adapter);
    const successes = rows.filter((x) => x.success).length;
    perRail[adapter] = {
      runs: rows.length,
      successes,
      failures: rows.length - successes,
      successRate: rows.length === 0 ? 0 : successes / rows.length,
      avgProveMs: avg(rows.map((x) => x.proveMs)),
      avgVerifyMs: avg(rows.map((x) => x.verifyMs)),
      avgSubmitMs: avg(rows.map((x) => x.submitMs)),
      avgAttestMs: avg(rows.map((x) => x.attestMs)),
    };
  }
  const successes = all.filter((x) => x.success).length;
  const report: TestReportRecord = {
    ranAt: Date.now(),
    totalRuns: all.length,
    perRail,
    overallSuccessRate: all.length === 0 ? 0 : successes / all.length,
    avgProveMs: avg(all.map((x) => x.proveMs)),
    avgVerifyMs: avg(all.map((x) => x.verifyMs)),
    failures: all.filter((x) => !x.success).map((x) => ({ adapter: x.adapter, reason: x.reason ?? "" })),
  };
  saveReport(report);
  return report;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}
