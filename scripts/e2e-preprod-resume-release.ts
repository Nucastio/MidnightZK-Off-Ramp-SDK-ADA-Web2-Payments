/**
 * Resume driver for E2E run 1: stage 8 (Cardano RELEASE) only.
 *
 * Run 1 completed stages 0-7 against real infrastructure but the first
 * RELEASE submission was rejected by the chain with
 * OutsideValidityIntervalUTxO: the local clock was ~8 slots ahead of the
 * Preprod tip and submitReleaseTx pinned validFrom = Date.now().
 * sdk/src/cardano/release.ts now back-dates validFrom by
 * CARDANO_RELEASE_CLOCK_SKEW_MS (default 120000 ms).
 *
 * This driver re-signs a FRESH ReleaseAuthorization (same settlement digest
 * and Midnight settlement receipt hash proved in stages 5-7, new expiry) for
 * the stored lock UTxO, submits the release as the operator, awaits
 * confirmation, and updates the evidence files. The original rejection is
 * preserved verbatim in the evidence.
 *
 *   npx tsx scripts/e2e-preprod-resume-release.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAppLucid,
  paymentAddressFromPkh,
  paymentPkhFromAddress,
  releaseAuthorizationMessageCbor,
  releaseAuthorizationMessageForUtxo,
  releaseRedeemerCbor,
  submitReleaseTx,
} from "../sdk/src/index.ts";
import { signReleaseAuthorization } from "../sdk/src/oracle/settlement-oracle.ts";
import {
  awaitTxConfirmed,
  bfGet,
  errorVerbatim,
  explorerTx,
  nowIso,
  txUtxos,
  withRetry,
  writeEvidenceJson,
  writeEvidenceMarkdown,
} from "./e2e-lib.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs/evidence/v2.0.0");
const EVIDENCE_JSON = path.join(EVIDENCE_DIR, "e2e-run-1.json");
const EVIDENCE_MD = path.join(EVIDENCE_DIR, "e2e-run-1.md");

const OPERATOR_FUNDING_TX = "411d2eeea83fe30d12eff37f2ffd0babff737049fb957047f2ebb2ec88b9c241";
const ESCROW_LOVELACE = 5_000_000n;
const FRESH_AUTH_WINDOW_MS = 30 * 60 * 1000;

async function main(): Promise<void> {
  const evidence = JSON.parse(readFileSync(EVIDENCE_JSON, "utf8")) as Record<string, any>;
  const s = evidence.stages;
  const lock = s["2-cardano-lock"];
  const attestation = s["5-oracle-attestation"].attestation;
  const settlementReceipt = s["6-midnight-settlement"].receipt;
  const firstAttempt = s["8-cardano-release"];
  const deadlineMs = s["1-initiate"].initiate.deadline * 1000;
  if (!lock?.txHash || !attestation?.settlementDigest || !settlementReceipt?.receiptHash) {
    throw new Error("evidence file is missing stage 2/5/6 artifacts; cannot resume");
  }
  const lockOutRef = { txHash: lock.txHash as string, outputIndex: lock.outputIndex as number };
  console.log(`[resume] lock UTxO ${lockOutRef.txHash}#${lockOutRef.outputIndex}, deadline ${new Date(deadlineMs).toISOString()}`);

  const operatorLucid = await createAppLucid("operator");
  const operatorAddress = await operatorLucid.wallet().address();
  if (paymentPkhFromAddress(operatorAddress) !== lock.datum.operatorPkh) {
    throw new Error("operator wallet does not match the stored datum.operatorPkh");
  }
  // submitReleaseTx pays the escrow bundle to the ENTERPRISE address derived
  // from datum.operatorPkh (resolveEscrowUtxo → paymentAddressFromPkh).
  const operatorPayoutAddress = paymentAddressFromPkh("Preprod", lock.datum.operatorPkh);

  const startedMs = Date.now();

  // Idempotent resume: if a release tx was already submitted by a previous
  // invocation (whose evidence write was interrupted), verify THAT tx
  // instead of double-spending. The fresh authorization signed for it is
  // reproducible bit-for-bit: the canonical message is a pure function of
  // the stored datum + outRef + body, and Ed25519 (RFC 8032) is
  // deterministic, so signing the same bytes with the oracle key yields the
  // exact signature carried in the submitted redeemer (cross-checked
  // against the on-chain redeemer CBOR below).
  const existingReleaseTx = process.env.RESUME_RELEASE_TX?.trim();
  let releaseTxHash: string;
  let authorizationExpiry: bigint;
  let authorizationMessageCbor: string;
  let oracleSignature: string;
  let redeemerCrossCheck: Record<string, unknown> | undefined;
  if (existingReleaseTx) {
    const expiryMs = process.env.RESUME_RELEASE_EXPIRY_MS?.trim();
    if (!expiryMs) throw new Error("RESUME_RELEASE_EXPIRY_MS is required with RESUME_RELEASE_TX");
    authorizationExpiry = BigInt(expiryMs);
    releaseTxHash = existingReleaseTx;
    const datum = {
      ...lock.datum,
      deadline: BigInt(lock.datum.deadline),
    };
    authorizationMessageCbor = releaseAuthorizationMessageCbor(datum, lockOutRef, {
      settlementDigest: attestation.settlementDigest,
      midnightSettlementReceiptHash: settlementReceipt.receiptHash,
      authorizationExpiry,
    });
    oracleSignature = signReleaseAuthorization(authorizationMessageCbor);
    // Cross-check the recomputed redeemer against the on-chain redeemer CBOR.
    const expectedRedeemer = releaseRedeemerCbor({
      settlementDigest: attestation.settlementDigest,
      midnightSettlementReceiptHash: settlementReceipt.receiptHash,
      authorizationExpiry,
      oracleSignature,
    });
    const redeemers = await bfGet<Array<{ purpose: string; redeemer_data_hash: string }>>(
      `/txs/${releaseTxHash}/redeemers`,
    );
    if (redeemers.status !== 200 || !Array.isArray(redeemers.body) || redeemers.body.length !== 1) {
      throw new Error(`could not fetch the on-chain redeemer of ${releaseTxHash}: HTTP ${redeemers.status}`);
    }
    const cbor = await bfGet<{ cbor: string }>(`/scripts/datum/${redeemers.body[0].redeemer_data_hash}/cbor`);
    if (cbor.status !== 200) {
      throw new Error(`could not fetch redeemer CBOR: HTTP ${cbor.status}`);
    }
    if (cbor.body.cbor !== expectedRedeemer) {
      throw new Error(
        `on-chain redeemer does not match the recomputed authorization: onChain=${cbor.body.cbor} recomputed=${expectedRedeemer}`,
      );
    }
    redeemerCrossCheck = {
      matches: true,
      onChainRedeemerDataHash: redeemers.body[0].redeemer_data_hash,
      source: `Blockfrost /txs/${releaseTxHash}/redeemers + /scripts/datum/{hash}/cbor`,
      note: "Recomputed redeemer CBOR (deterministic Ed25519 re-signature of the canonical authorization message) is byte-identical to the redeemer recorded on-chain.",
    };
    console.log(`[resume] verifying already-submitted RELEASE ${releaseTxHash} (redeemer cross-check OK)`);
  } else {
    if (Date.now() >= deadlineMs) {
      throw new Error(`escrow deadline ${new Date(deadlineMs).toISOString()} has passed; only the refund path remains`);
    }
    // Fresh authorization: same digest + settlement receipt hash, new expiry.
    authorizationExpiry = BigInt(Math.min(deadlineMs, Date.now() + FRESH_AUTH_WINDOW_MS));
    const body = {
      settlementDigest: attestation.settlementDigest as string,
      midnightSettlementReceiptHash: settlementReceipt.receiptHash as string,
      authorizationExpiry,
    };
    authorizationMessageCbor = await releaseAuthorizationMessageForUtxo(
      operatorLucid,
      lockOutRef,
      body,
    );
    oracleSignature = signReleaseAuthorization(authorizationMessageCbor);
    console.log(`[resume] fresh authorization signed (expiry ${new Date(Number(authorizationExpiry)).toISOString()})`);
    const res = await withRetry("submitReleaseTx", () =>
      submitReleaseTx(operatorLucid, lockOutRef, { ...body, oracleSignature }),
    );
    releaseTxHash = res.txHash;
    console.log(`[resume] RELEASE submitted ${releaseTxHash}`);
  }

  const funding = await awaitTxConfirmed(OPERATOR_FUNDING_TX, { minConfirmations: 2 });
  const confirmation = await awaitTxConfirmed(releaseTxHash, { minConfirmations: 1 });
  const utxos = await txUtxos(releaseTxHash);
  const spendsEscrow = utxos.inputs.some(
    (i) => !i.collateral && i.tx_hash === lockOutRef.txHash && i.output_index === lockOutRef.outputIndex,
  );
  if (!spendsEscrow) throw new Error("release tx does not spend the expected escrow UTxO");
  const escrowPayout = utxos.outputs.find(
    (o) =>
      !o.collateral &&
      o.address === operatorPayoutAddress &&
      o.amount.find((a) => a.unit === "lovelace")?.quantity === ESCROW_LOVELACE.toString(),
  );
  if (!escrowPayout) {
    throw new Error(
      `release outputs missing the exact ${ESCROW_LOVELACE} lovelace payout to the operator payout address ${operatorPayoutAddress}`,
    );
  }

  // Update stage 8 in place: keep the first (rejected) attempt verbatim.
  s["8-cardano-release"] = {
    startedAt: firstAttempt.startedAt,
    completedAt: nowIso(),
    durationMs: (firstAttempt.durationMs ?? 0) + (Date.now() - startedMs),
    clockSkewIncident: {
      summary:
        "First RELEASE submission (09:27:45Z) was rejected by the Preprod node: the local clock was ~8 slots ahead of the chain tip and submitReleaseTx pinned the tx validity start to Date.now() (slot 128683667 > tip slot 128683659). Fixed by back-dating validFrom by CARDANO_RELEASE_CLOCK_SKEW_MS (default 120000 ms) in sdk/src/cardano/release.ts; SDK rebuilt and its test suite re-run (27/27) before this resume. Stages 0-7 were NOT re-run; this stage re-signed a fresh ReleaseAuthorization over the same settlement digest and Midnight settlement receipt hash.",
      firstAttempt,
    },
    resumedBy: "scripts/e2e-preprod-resume-release.ts",
    txHash: releaseTxHash,
    spendsLockUtxo: `${lockOutRef.txHash}#${lockOutRef.outputIndex}`,
    operatorFundingConfirmationsAtRelease: funding.confirmations,
    authorization: {
      body: {
        settlementDigest: attestation.settlementDigest,
        midnightSettlementReceiptHash: settlementReceipt.receiptHash,
        authorizationExpiry,
      },
      authorizationExpiryIso: new Date(Number(authorizationExpiry)).toISOString(),
      authorizationMessageCbor,
      oracleSignature,
      ...(redeemerCrossCheck ? { redeemerCrossCheck } : {}),
      note: "Fresh authorization for the resumed attempt; supersedes the stage-7 signature (same canonical message fields except authorizationExpiry).",
    },
    confirmation: {
      blockHeight: confirmation.tx.block_height,
      blockHash: confirmation.tx.block,
      blockTime: confirmation.tx.block_time,
      fees: confirmation.tx.fees,
      confirmations: confirmation.confirmations,
      waitMs: confirmation.waitMs,
    },
    escrowPayoutToOperator: {
      address: operatorPayoutAddress,
      addressNote:
        "Enterprise (payment-credential-only) address derived from datum.operatorPkh — the datum-bound destination enforced by submitReleaseTx; same payment key as the operator base address.",
      outputIndex: escrowPayout.output_index,
      lovelace: ESCROW_LOVELACE,
    },
    allOutputs: utxos.outputs.map((o) => ({
      outputIndex: o.output_index,
      address: o.address,
      lovelace: o.amount.find((a) => a.unit === "lovelace")?.quantity,
      ...(o.collateral ? { collateralReturn: true } : {}),
    })),
    explorer: explorerTx(releaseTxHash),
  };
  delete evidence.failure;
  evidence.result = "PASSED";
  evidence.completedAt = nowIso();
  evidence.notes = [
    ...(evidence.notes ?? []),
    "Stage 8 was completed by the resume driver after a clock-skew rejection of the first release submission; see stages['8-cardano-release'].clockSkewIncident for the original error verbatim.",
  ];
  writeEvidenceJson(EVIDENCE_JSON, evidence);
  writeEvidenceMarkdown(EVIDENCE_MD, renderMarkdown(evidence));
  console.log("\nRELEASE resumed and confirmed. E2E run 1 PASSED.");
  process.exit(0);
}

function renderMarkdown(evidence: Record<string, any>): string {
  const s = evidence.stages;
  const pre = s["0-preflight"];
  const init = s["1-initiate"];
  const lock = s["2-cardano-lock"];
  const mi = s["3-midnight-intent"];
  const pay = s["4-revolut-payout"];
  const orc = s["5-oracle-attestation"];
  const ms = s["6-midnight-settlement"];
  const auth = s["7-release-authorization"];
  const rel = s["8-cardano-release"];
  const it = mi.receipt.transactions;
  const lastPoll = pay.statusPolls[pay.statusPolls.length - 1];
  const midnightTxRow = (label: string, tx: any) =>
    `| ${label} | \`${tx.txId}\` | ${tx.blockHeight} | \`${tx.blockHash.slice(0, 16)}…\` |`;
  return `# E2E Run 1 — Full Off-Ramp Happy Path (REAL infrastructure)

- **Result:** ${evidence.result}
- **Started:** ${evidence.startedAt} — **Completed:** ${evidence.completedAt}
- **Flow:** SDK initiate → Preprod LOCK → Midnight intent proofs → Revolut sandbox payout (SETTLED) → oracle attestation → Midnight settlement proof → signed ReleaseAuthorization → Preprod RELEASE
- Machine-readable evidence: [\`e2e-run-1.json\`](./e2e-run-1.json)

## Environment

| Component | Value |
|---|---|
| Cardano | Preprod via Blockfrost (\`${pre.cardano.blockfrostBase}\`) |
| Escrow script | \`${pre.cardano.scriptAddress}\` |
| Sender wallet | \`${pre.cardano.senderAddress}\` (pkh \`${pre.cardano.senderPkh}\`) |
| Operator wallet (distinct) | \`${pre.cardano.operatorAddress}\` (pkh \`${pre.cardano.operatorPkh}\`) |
| Operator funding | [\`${pre.cardano.operatorFunding.txHash}\`](${pre.cardano.operatorFunding.explorer}) |
| Midnight | local devnet \`${pre.midnight.networkId}\` — node \`${pre.midnight.node}\`, indexer \`${pre.midnight.indexer}\`, proof server \`${pre.midnight.proofServer}\` |
| Rail | Revolut Business **live sandbox** (\`sandbox-b2b.revolut.com\`), adapter mode \`${pre.rail.mode}\` |

## 1. Intent (SDK \`initiateOffRamp\`)

| Field | Value |
|---|---|
| intentId | \`${init.initiate.intentId}\` |
| adapter / payee | \`revolut\` / \`${init.params.payeeHandle}\` |
| fiat | ${init.params.fiatAmount} ${init.params.fiatCurrency} |
| escrow | ${Number(init.params.escrowLovelace) / 1e6} tADA |
| payeeCommitment | \`${init.initiate.payeeCommitment}\` |
| amountCommitment | \`${init.initiate.amountCommitment}\` |
| adapterTag | \`${init.initiate.adapterTag}\` |
| artifact (vk) hash | \`${init.initiate.vkHash}\` |
| deadline | ${lock.deadlineIso} (~45 min) |

## 2. Cardano LOCK

- **Tx:** [\`${lock.txHash}\`](${lock.explorer})
- Escrow UTxO: \`${lock.txHash}#${lock.outputIndex}\` — ${Number(lock.escrowLovelace) / 1e6} tADA at \`${lock.scriptAddress}\`
- Block ${lock.confirmation.blockHeight}, confirmed after ${Math.round(lock.confirmation.waitMs / 1000)}s
- Hardened inline datum: distinct sender/operator PKHs, real artifact hash, oracle Ed25519 pubkey \`${auth.oraclePublicKey}\`
- On-chain datum round-trip decode matches submitted datum: **${lock.onChainDatumRoundTripOk}**

## 3. Midnight intent proofs (local devnet, real proof server)

- Contract (own instance): \`${mi.receipt.contractAddress}\`
- Intent receipt hash: \`${mi.receipt.receiptHash}\`
- Public state hash: \`${mi.receipt.publicStateHash}\`
- l1Anchor bound to the LOCK tx hash: \`${mi.receipt.publicState.l1Anchor}\`
- Online verification (indexer + finalized state): **ok**, ${mi.verify.verifyDurationMs}ms; prove ${mi.proveDurationMs}ms

| Operation | txId | Block | Block hash |
|---|---|---|---|
${midnightTxRow("deploy", it.deployment)}
${midnightTxRow("bindOffRampIntent", it.bindOffRampIntent)}
${midnightTxRow("provePayeeBinding", it.provePayeeBinding)}
${midnightTxRow("proveAmountBinding", it.proveAmountBinding)}

## 4. Revolut live sandbox payout

- Payment id (railTxRef): \`${pay.submit.railTxRef}\`
- request_id (idempotency): \`${pay.submit.providerReference.idempotencyKey}\`
- counterparty: \`${pay.submit.providerReference.recipientId}\`
- Submit state: \`${pay.submit.raw.providerState}\` → authenticated status polls → **SETTLED** (provider state \`${lastPoll.providerState}\` at ${new Date(lastPoll.observedAt).toISOString()})

## 5. Settlement oracle attestation

- settlementDigest: \`${orc.attestation.settlementDigest}\`
- signedAt: ${orc.attestation.signedAt} — signature: \`${orc.attestation.signature.slice(0, 32)}…\`
- Derivation: ${orc.derivation}

## 6. Midnight settlement proof

- \`proveOffRampSettlement\` tx: \`${ms.receipt.transaction.txId}\` (block ${ms.receipt.transaction.blockHeight})
- Settlement receipt hash: \`${ms.receipt.receiptHash}\`
- Ledger settlementDigest now equals the oracle digest: \`${ms.receipt.publicState.settlementDigest}\`
- Online verification: **ok**, ${ms.verify.verifyDurationMs}ms; prove ${ms.settleDurationMs}ms

## 7. Release authorization (canonical bytes, two-step)

- Lock UTxO: \`${auth.lockUtxo.txHash}#${auth.lockUtxo.outputIndex}\`
- Canonical message (CBOR hex): \`${auth.authorizationMessageCbor.slice(0, 96)}…\` (full value in JSON)
- Oracle Ed25519 signature (stage 7): \`${auth.oracleSignature}\`
- The confirmed release used a fresh authorization over the same message fields with a new expiry (${rel.authorization.authorizationExpiryIso}); signature \`${rel.authorization.oracleSignature}\`

## 8. Cardano RELEASE

- **Tx:** [\`${rel.txHash}\`](${rel.explorer})
- Spends escrow UTxO \`${rel.spendsLockUtxo}\`; pays the exact ${Number(rel.escrowPayoutToOperator.lovelace) / 1e6} tADA escrow to the operator address (output #${rel.escrowPayoutToOperator.outputIndex}); fees paid from the operator's own UTxO
- Block ${rel.confirmation.blockHeight}, confirmed after ${Math.round(rel.confirmation.waitMs / 1000)}s

### Incident (recorded honestly)

The FIRST release submission was rejected by the Preprod node with
\`OutsideValidityIntervalUTxO\` — the local clock was ~8 slots ahead of the
chain tip while \`submitReleaseTx\` pinned \`validFrom = Date.now()\`. The fix
back-dates \`validFrom\` by \`CARDANO_RELEASE_CLOCK_SKEW_MS\` (default 120 s)
in \`sdk/src/cardano/release.ts\`. Stages 0–7 were not re-run; the resume
driver re-signed a fresh authorization over the same settlement digest and
receipt hash. Original error (verbatim) is preserved at
\`stages["8-cardano-release"].clockSkewIncident.firstAttempt.error\` in the JSON.

## Stage timings

| Stage | Duration |
|---|---|
${Object.entries(s)
  .map(([k, v]: [string, any]) => `| ${k} | ${Math.round((v.durationMs ?? 0) / 100) / 10}s |`)
  .join("\n")}
`;
}

main().catch((e) => {
  console.error("RESUME FAILED:", errorVerbatim(e));
  process.exit(1);
});
