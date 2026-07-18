/**
 * REFUND-path E2E against REAL Cardano Preprod infrastructure, with
 * machine-readable evidence capture. No mocks, no fabricated values.
 *
 *   npx tsx scripts/e2e-preprod-refund.ts
 *
 * Path exercised:
 *   1. SDK initiateOffRamp with a short escrow deadline (240 s)
 *   2. Preprod LOCK with the hardened datum (~5 ADA)
 *   3. Await confirmation
 *   4. Attempt REFUND BEFORE the deadline — the submission must be rejected
 *      (the refund tx validity interval starts at the datum deadline, so the
 *      node refuses it); the rejection error is captured VERBATIM
 *   5. Wait until past the deadline
 *   6. Submit the REFUND, await confirmation, and verify the full escrow
 *      value returned to the sender address
 *
 * Evidence: docs/evidence/v2.0.0/e2e-refund-1.json + e2e-refund-1.md
 * On failure: the exact failing stage + verbatim error are written to the
 * evidence JSON and the flow stops.
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OffRampSDK,
  createAppLucid,
  decodeEscrowDatumCbor,
  escrowScriptAddress,
  operatorPublicKeyHex,
  paymentAddressFromPkh,
  paymentPkhFromAddress,
  submitLockTx,
  submitRefundTx,
} from "../sdk/src/index.ts";
import { createMidnightProofProviderFromEnv } from "../midnight-local-cli/src/index.ts";
import {
  awaitTxConfirmed,
  chainTip,
  errorVerbatim,
  explorerTx,
  findOutputToAddress,
  jsonReplacer,
  nowIso,
  sleep,
  txUtxos,
  withRetry,
  writeEvidenceJson,
  writeEvidenceMarkdown,
} from "./e2e-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs/evidence/v2.0.0");
const EVIDENCE_JSON = path.join(EVIDENCE_DIR, "e2e-refund-1.json");
const EVIDENCE_MD = path.join(EVIDENCE_DIR, "e2e-refund-1.md");

const ADAPTER = "revolut" as const;
const PAYEE_HANDLE = "@test_user_rv";
const FIAT_AMOUNT = "1.00";
const FIAT_CURRENCY = "GBP" as const;
const ESCROW_LOVELACE = 5_000_000n;
const DEADLINE_SECONDS = 240; // ESCROW_DEADLINE_SECONDS=240 for the refund demo
const POST_DEADLINE_BUFFER_MS = 60_000; // slot/clock safety margin before refund submit

const evidence: Record<string, unknown> & { stages: Record<string, unknown> } = {
  kind: "OFFRAMP_E2E_PREPROD_REFUND_PATH",
  version: "2.0.0",
  script: "scripts/e2e-preprod-refund.ts",
  startedAt: nowIso(),
  stages: {},
};

interface StageMeta {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

async function stage<T extends Record<string, unknown>>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedMs = Date.now();
  const meta: StageMeta = { startedAt: new Date(startedMs).toISOString() };
  console.log(`\n━━━ [${name}] ${meta.startedAt}`);
  try {
    const result = await fn();
    meta.completedAt = nowIso();
    meta.durationMs = Date.now() - startedMs;
    evidence.stages[name] = { ...meta, ...result };
    console.log(`━━━ [${name}] done in ${meta.durationMs}ms`);
    return result;
  } catch (error) {
    meta.completedAt = nowIso();
    meta.durationMs = Date.now() - startedMs;
    evidence.stages[name] = { ...meta, error: errorVerbatim(error) };
    evidence.failure = { stage: name, error: errorVerbatim(error) };
    evidence.completedAt = nowIso();
    evidence.result = "FAILED";
    writeEvidenceJson(EVIDENCE_JSON, evidence);
    console.error(`\nREFUND E2E FAILED at stage [${name}]:`, error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const senderLucid = await createAppLucid("sender");
  const senderAddress = await senderLucid.wallet().address();
  const senderPkh = paymentPkhFromAddress(senderAddress);
  const operatorLucid = await createAppLucid("operator");
  const operatorPkh = paymentPkhFromAddress(await operatorLucid.wallet().address());

  await stage("0-preflight", async () => {
    if ((process.env.CARDANO_NETWORK ?? "Preprod") !== "Preprod") {
      throw new Error(`CARDANO_NETWORK must be Preprod (got ${process.env.CARDANO_NETWORK})`);
    }
    if (senderPkh === operatorPkh) {
      throw new Error("sender and operator wallets must be distinct for the hardened datum");
    }
    const tip = await chainTip();
    return {
      cardano: {
        network: "Preprod",
        blockfrostBase: process.env.BLOCKFROST_URL,
        tipAtStart: tip,
        scriptAddress: escrowScriptAddress("Preprod"),
        senderAddress,
        senderPkh,
        operatorPkh,
      },
      escrowDeadlineSeconds: DEADLINE_SECONDS,
    };
  });

  // The provider is only used to satisfy the SDK's fail-closed constructor
  // (it validates the packaged Midnight artifacts); no Midnight calls are
  // made on the refund path.
  const sdk = new OffRampSDK({
    senderPkh,
    operatorPkh,
    escrowLovelace: ESCROW_LOVELACE,
    deadlineSeconds: DEADLINE_SECONDS,
    midnightProofProvider: createMidnightProofProviderFromEnv() as never,
  });

  const init = await stage("1-initiate", async () => {
    const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
      adapter: ADAPTER,
      payeeHandle: PAYEE_HANDLE,
      amountAda: Number(ESCROW_LOVELACE) / 1_000_000,
      fiatAmount: FIAT_AMOUNT,
      fiatCurrency: FIAT_CURRENCY,
    });
    console.log(`[initiate] intentId=${initiate.intentId} deadline=${new Date(initiate.deadline * 1000).toISOString()}`);
    return {
      params: {
        adapter: ADAPTER,
        payeeHandle: PAYEE_HANDLE,
        fiatAmount: FIAT_AMOUNT,
        fiatCurrency: FIAT_CURRENCY,
        escrowLovelace: ESCROW_LOVELACE,
        deadlineSeconds: DEADLINE_SECONDS,
      },
      initiate,
      witnesses: { payeeSalt, amountSalt },
      railQuote,
    };
  });
  const initiate = init.initiate;

  const lock = await stage("2-cardano-lock", async () => {
    const datum = {
      intentId: initiate.intentId,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
      deadline: BigInt(initiate.deadline) * 1000n,
      circuitArtifactHash: initiate.vkHash,
      senderPkh,
      operatorPkh,
      oraclePublicKey: operatorPublicKeyHex(),
    };
    const res = await withRetry("submitLockTx", () =>
      submitLockTx(senderLucid, datum, initiate.escrowLovelace),
    );
    console.log(`[lock] submitted ${res.txHash}`);
    const confirmation = await awaitTxConfirmed(res.txHash, { minConfirmations: 1 });
    const escrowOutput = await findOutputToAddress(res.txHash, res.scriptAddress);
    if (!escrowOutput.inlineDatum) throw new Error("on-chain escrow output has no inline datum");
    const decoded = decodeEscrowDatumCbor(escrowOutput.inlineDatum);
    if (decoded.deadline !== datum.deadline || decoded.senderPkh !== datum.senderPkh) {
      throw new Error(`on-chain datum round-trip mismatch: ${JSON.stringify(decoded, jsonReplacer)}`);
    }
    return {
      txHash: res.txHash,
      scriptAddress: res.scriptAddress,
      outputIndex: escrowOutput.outputIndex,
      escrowLovelace: res.lockLovelace,
      datum,
      datumCbor: res.datumCbor,
      onChainInlineDatum: escrowOutput.inlineDatum,
      deadlineIso: new Date(initiate.deadline * 1000).toISOString(),
      confirmation: {
        blockHeight: confirmation.tx.block_height,
        blockHash: confirmation.tx.block,
        blockTime: confirmation.tx.block_time,
        fees: confirmation.tx.fees,
        confirmations: confirmation.confirmations,
        waitMs: confirmation.waitMs,
      },
      explorer: explorerTx(res.txHash),
    };
  });
  const lockOutRef = { txHash: lock.txHash as string, outputIndex: lock.outputIndex as number };
  const deadlineMs = initiate.deadline * 1000;

  // Stage 3: refund attempt BEFORE the deadline must be rejected.
  await stage("3-early-refund-rejected", async () => {
    const attemptedAt = Date.now();
    if (attemptedAt >= deadlineMs) {
      throw new Error(
        `cannot demonstrate early-refund rejection: deadline ${new Date(deadlineMs).toISOString()} already passed before the attempt`,
      );
    }
    console.log(
      `[early-refund] attempting refund ${Math.round((deadlineMs - attemptedAt) / 1000)}s BEFORE the deadline…`,
    );
    try {
      const res = await submitRefundTx(senderLucid, lockOutRef);
      // A success here means the time-lock failed — that is a real finding, not evidence of success.
      throw new Error(
        `SECURITY FAILURE: early refund was accepted before the deadline (tx ${res.txHash})`,
      );
    } catch (error) {
      const verbatim = errorVerbatim(error);
      if (verbatim.message.startsWith("SECURITY FAILURE")) throw error;
      console.log(`[early-refund] rejected as expected: ${verbatim.message.slice(0, 300)}`);
      return {
        attemptedAt: new Date(attemptedAt).toISOString(),
        secondsBeforeDeadline: Math.round((deadlineMs - attemptedAt) / 1000),
        rejected: true,
        rejectionErrorVerbatim: verbatim,
        note: "submitRefundTx pins the tx validity interval to start at the datum deadline (sdk/src/cardano/refund.ts); before the deadline the node/Blockfrost refuses the submission. Error captured verbatim above.",
      };
    }
  });

  // Stage 4: wait past the deadline (plus a safety buffer).
  await stage("4-wait-past-deadline", async () => {
    const waitUntil = deadlineMs + POST_DEADLINE_BUFFER_MS;
    const waitMs = Math.max(0, waitUntil - Date.now());
    console.log(`[wait] sleeping ${Math.round(waitMs / 1000)}s until past deadline ${new Date(deadlineMs).toISOString()} (+${POST_DEADLINE_BUFFER_MS / 1000}s buffer)…`);
    await sleep(waitMs);
    const tip = await chainTip();
    return {
      deadlineIso: new Date(deadlineMs).toISOString(),
      resumedAt: nowIso(),
      bufferMs: POST_DEADLINE_BUFFER_MS,
      tipAfterWait: tip,
    };
  });

  // Stage 5: post-deadline refund succeeds; full escrow value returns to sender.
  await stage("5-cardano-refund", async () => {
    const res = await withRetry("submitRefundTx", () => submitRefundTx(senderLucid, lockOutRef));
    console.log(`[refund] submitted ${res.txHash}`);
    const confirmation = await awaitTxConfirmed(res.txHash, { minConfirmations: 1 });
    const utxos = await txUtxos(res.txHash);
    const spendsEscrow = utxos.inputs.some(
      (i) => !i.collateral && i.tx_hash === lockOutRef.txHash && i.output_index === lockOutRef.outputIndex,
    );
    if (!spendsEscrow) throw new Error("refund tx does not spend the expected escrow UTxO");
    // submitRefundTx pays the escrow bundle to the ENTERPRISE address derived
    // from datum.senderPkh (resolveEscrowUtxo → paymentAddressFromPkh).
    const senderRefundAddress = paymentAddressFromPkh("Preprod", senderPkh);
    const escrowReturn = utxos.outputs.find(
      (o) =>
        !o.collateral &&
        o.address === senderRefundAddress &&
        o.amount.find((a) => a.unit === "lovelace")?.quantity === ESCROW_LOVELACE.toString(),
    );
    if (!escrowReturn) {
      throw new Error(
        `refund outputs do not contain the exact ${ESCROW_LOVELACE} lovelace escrow return to ${senderRefundAddress}: ${JSON.stringify(utxos.outputs.map((o) => ({ address: o.address, lovelace: o.amount.find((a) => a.unit === "lovelace")?.quantity, collateral: o.collateral })))}`,
      );
    }
    return {
      txHash: res.txHash,
      spendsLockUtxo: `${lockOutRef.txHash}#${lockOutRef.outputIndex}`,
      confirmation: {
        blockHeight: confirmation.tx.block_height,
        blockHash: confirmation.tx.block,
        blockTime: confirmation.tx.block_time,
        fees: confirmation.tx.fees,
        confirmations: confirmation.confirmations,
        waitMs: confirmation.waitMs,
      },
      escrowReturnToSender: {
        address: senderRefundAddress,
        addressNote:
          "Enterprise (payment-credential-only) address derived from datum.senderPkh — the datum-bound destination enforced by submitRefundTx; same payment key as the sender base address.",
        outputIndex: escrowReturn.output_index,
        lovelace: ESCROW_LOVELACE,
      },
      allOutputs: utxos.outputs.map((o) => ({
        outputIndex: o.output_index,
        address: o.address,
        lovelace: o.amount.find((a) => a.unit === "lovelace")?.quantity,
        ...(o.collateral ? { collateralReturn: true } : {}),
      })),
      explorer: explorerTx(res.txHash),
    };
  });

  evidence.completedAt = nowIso();
  evidence.result = "PASSED";
  writeEvidenceJson(EVIDENCE_JSON, evidence);
  writeEvidenceMarkdown(EVIDENCE_MD, renderMarkdown());
  console.log("\nREFUND E2E COMPLETE.");
  process.exit(0);
}

function renderMarkdown(): string {
  const s = evidence.stages as Record<string, any>;
  const pre = s["0-preflight"];
  const init = s["1-initiate"];
  const lock = s["2-cardano-lock"];
  const early = s["3-early-refund-rejected"];
  const wait = s["4-wait-past-deadline"];
  const refund = s["5-cardano-refund"];
  return `# E2E Refund Run 1 — Deadline-Gated Refund Path (REAL infrastructure)

- **Result:** ${evidence.result}
- **Started:** ${evidence.startedAt} — **Completed:** ${evidence.completedAt}
- **Flow:** SDK initiate (deadline 240 s) → Preprod LOCK → early refund attempt **rejected** → wait past deadline → REFUND confirmed, full escrow value back to the sender
- Machine-readable evidence: [\`e2e-refund-1.json\`](./e2e-refund-1.json)

## Environment

| Component | Value |
|---|---|
| Cardano | Preprod via Blockfrost (\`${pre.cardano.blockfrostBase}\`) |
| Escrow script | \`${pre.cardano.scriptAddress}\` |
| Sender wallet | \`${pre.cardano.senderAddress}\` (pkh \`${pre.cardano.senderPkh}\`) |
| Escrow deadline | ${pre.escrowDeadlineSeconds} s (ESCROW_DEADLINE_SECONDS=240) |

## 1. Intent

| Field | Value |
|---|---|
| intentId | \`${init.initiate.intentId}\` |
| payeeCommitment | \`${init.initiate.payeeCommitment}\` |
| amountCommitment | \`${init.initiate.amountCommitment}\` |
| escrow | ${Number(init.params.escrowLovelace) / 1e6} tADA |
| deadline | ${lock.deadlineIso} |

## 2. Cardano LOCK

- **Tx:** [\`${lock.txHash}\`](${lock.explorer})
- Escrow UTxO: \`${lock.txHash}#${lock.outputIndex}\` — ${Number(lock.escrowLovelace) / 1e6} tADA at \`${lock.scriptAddress}\`
- Block ${lock.confirmation.blockHeight}, confirmed after ${Math.round(lock.confirmation.waitMs / 1000)}s

## 3. Early refund attempt — REJECTED (as designed)

- Attempted at ${early.attemptedAt}, **${early.secondsBeforeDeadline} s before** the datum deadline
- The SDK pins the refund tx validity interval to start at the datum deadline, so the chain refuses it before then
- Rejection error (verbatim):

\`\`\`
${early.rejectionErrorVerbatim.message}
\`\`\`

## 4. Wait past deadline

- Deadline ${wait.deadlineIso} + ${wait.bufferMs / 1000} s buffer; resumed ${wait.resumedAt}

## 5. Cardano REFUND — full value back to sender

- **Tx:** [\`${refund.txHash}\`](${refund.explorer})
- Spends escrow UTxO \`${refund.spendsLockUtxo}\`
- Returns the exact ${Number(ESCROW_LOVELACE) / 1e6} tADA escrow to the sender's datum-bound payout address \`${refund.escrowReturnToSender.address}\` (output #${refund.escrowReturnToSender.outputIndex}); fees paid from the sender's own wallet input
- Block ${refund.confirmation.blockHeight}, confirmed after ${Math.round(refund.confirmation.waitMs / 1000)}s

## Stage timings

| Stage | Duration |
|---|---|
${Object.entries(s)
  .map(([k, v]: [string, any]) => `| ${k} | ${Math.round((v.durationMs ?? 0) / 100) / 10}s |`)
  .join("\n")}
`;
}

main().catch((e) => {
  evidence.completedAt = nowIso();
  evidence.result = "FAILED";
  evidence.failure = { stage: "unhandled", error: errorVerbatim(e) };
  writeEvidenceJson(EVIDENCE_JSON, evidence);
  console.error(e);
  process.exit(1);
});
