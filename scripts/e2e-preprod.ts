/**
 * FULL happy-path off-ramp E2E against REAL infrastructure, with
 * machine-readable evidence capture. No mocks, no fabricated values.
 *
 *   npx tsx scripts/e2e-preprod.ts
 *
 * Path exercised (mirrors the backend lifecycle CREATED → … → RELEASED):
 *   1. SDK initiateOffRamp (adapter: revolut, small GBP amount)
 *   2. Cardano Preprod LOCK with hardened datum (distinct sender/operator
 *      PKHs, real artifact-manifest hash, oracle Ed25519 pubkey, ~5 ADA,
 *      deadline ~45 min) via Blockfrost
 *   3. Await on-chain confirmation; round-trip-decode the on-chain datum
 *   4. Midnight local devnet: deploy own contract instance with the exact
 *      intent/commitments, bindOffRampIntent(lock tx hash),
 *      provePayeeBinding, proveAmountBinding via the real proof server;
 *      verify the intent receipt offline + online
 *   5. Revolut live sandbox payout via the SDK adapter; poll authenticated
 *      status to SETTLED
 *   6. Settlement oracle attestation (same construction as the backend) →
 *      settlement digest
 *   7. proveOffRampSettlement on the same Midnight contract; verify receipt
 *   8. Oracle signs the canonical ReleaseAuthorization for the exact lock
 *      UTxO (two-step escrow_script API)
 *   9. Cardano Preprod RELEASE via submitReleaseTx (operator wallet pays
 *      fees); await confirmation
 *
 * Evidence: docs/evidence/v2.0.0/e2e-run-1.json + e2e-run-1.md
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
  getAdapter,
  operatorPublicKeyHex,
  paymentAddressFromPkh,
  paymentPkhFromAddress,
  releaseAuthorizationMessageForUtxo,
  submitLockTx,
  submitReleaseTx,
  type MidnightIntentReceipt,
  type MidnightSettlementReceipt,
  type RailStatusObservation,
} from "../sdk/src/index.ts";
import {
  attestationFingerprint,
  signReleaseAuthorization,
} from "../sdk/src/oracle/settlement-oracle.ts";
import {
  createMidnightProofProviderFromEnv,
  OffRampMidnightConfig,
} from "../midnight-local-cli/src/index.ts";
import {
  awaitMidnightIndexerCatchUp,
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
const EVIDENCE_JSON = path.join(EVIDENCE_DIR, "e2e-run-1.json");
const EVIDENCE_MD = path.join(EVIDENCE_DIR, "e2e-run-1.md");

// Real Preprod tx that funded the distinct operator wallet with 200 tADA.
const OPERATOR_FUNDING_TX = "411d2eeea83fe30d12eff37f2ffd0babff737049fb957047f2ebb2ec88b9c241";

const ADAPTER = "revolut" as const;
const PAYEE_HANDLE = "@test_user_rv";
const FIAT_AMOUNT = "1.00";
const FIAT_CURRENCY = "GBP" as const;
const ESCROW_LOVELACE = 5_000_000n; // ~5 ADA escrow
const DEADLINE_SECONDS = 45 * 60; // ~45 min deadline window
const RELEASE_AUTH_WINDOW_MS = 10 * 60 * 1000; // backend default (OFFRAMP_RELEASE_AUTH_WINDOW_MS)

// ── Evidence scaffolding ─────────────────────────────────────────────────

const evidence: Record<string, unknown> & { stages: Record<string, unknown> } = {
  kind: "OFFRAMP_E2E_PREPROD_HAPPY_PATH",
  version: "2.0.0",
  script: "scripts/e2e-preprod.ts",
  startedAt: nowIso(),
  stages: {},
};

interface StageMeta {
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

async function stage<T extends Record<string, unknown>>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
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
    console.error(`\nE2E FAILED at stage [${name}]:`, error);
    process.exit(1);
  }
}

// ── Main flow ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Runtime handles are created outside the stage so only serializable data
  // ever enters the evidence object.
  const senderLucid = await createAppLucid("sender");
  const operatorLucid = await createAppLucid("operator");
  const senderAddress = await senderLucid.wallet().address();
  const operatorAddress = await operatorLucid.wallet().address();
  const senderPkh = paymentPkhFromAddress(senderAddress);
  const operatorPkh = paymentPkhFromAddress(operatorAddress);

  // Stage 0: environment + wallets + infra preflight.
  await stage("0-preflight", async () => {
    if ((process.env.CARDANO_NETWORK ?? "Preprod") !== "Preprod") {
      throw new Error(`CARDANO_NETWORK must be Preprod (got ${process.env.CARDANO_NETWORK})`);
    }
    if ((process.env.RAIL_ADAPTER_MODE ?? "mock") !== "sandbox") {
      throw new Error(`RAIL_ADAPTER_MODE must be sandbox for a live Revolut run (got ${process.env.RAIL_ADAPTER_MODE})`);
    }
    const adapter = getAdapter(ADAPTER);
    const health = adapter.health();
    if (adapter.mode !== "sandbox" || !health.ready) {
      throw new Error(`revolut adapter is not ready in sandbox mode: ${JSON.stringify(health)}`);
    }
    if (senderPkh === operatorPkh) {
      throw new Error("sender and operator wallets must be distinct for the hardened datum");
    }
    const scriptAddress = escrowScriptAddress("Preprod");

    // Operator funding must be on-chain before the operator ever spends.
    const funding = await awaitTxConfirmed(OPERATOR_FUNDING_TX, { minConfirmations: 1 });

    // Midnight devnet health + indexer catch-up (indexer was restarted recently).
    const midnightConfig = new OffRampMidnightConfig();
    if (midnightConfig.networkId !== "undeployed") {
      throw new Error(`MIDNIGHT_DEPLOY_NETWORK must resolve to the local devnet (got ${midnightConfig.networkId})`);
    }
    const proofServerHealth = await fetch(`${midnightConfig.proofServer}/health`).then((r) => r.text());
    const catchUp = await awaitMidnightIndexerCatchUp(midnightConfig.relayHttpOrigin, midnightConfig.indexer);

    const tip = await chainTip();
    return {
      cardano: {
        network: "Preprod",
        blockfrostBase: process.env.BLOCKFROST_URL,
        tipAtStart: tip,
        scriptAddress,
        senderAddress,
        senderPkh,
        operatorAddress,
        operatorPkh,
        operatorFunding: {
          txHash: OPERATOR_FUNDING_TX,
          blockHeight: funding.tx.block_height,
          confirmationsAtPreflight: funding.confirmations,
          explorer: explorerTx(OPERATOR_FUNDING_TX),
        },
      },
      midnight: {
        networkId: midnightConfig.networkId,
        node: midnightConfig.relayHttpOrigin,
        indexer: midnightConfig.indexer,
        proofServer: midnightConfig.proofServer,
        proofServerHealth,
        indexerCatchUp: catchUp,
      },
      rail: { adapter: ADAPTER, mode: adapter.mode, health },
    };
  });

  // Midnight proof provider validates the packaged circuit artifacts on construction.
  const midnightProvider = createMidnightProofProviderFromEnv();
  const sdk = new OffRampSDK({
    senderPkh,
    operatorPkh,
    escrowLovelace: ESCROW_LOVELACE,
    deadlineSeconds: DEADLINE_SECONDS,
    midnightProofProvider: midnightProvider as never,
  });

  // Stage 1: SDK initiate — commitments + intent metadata.
  const init = await stage("1-initiate", async () => {
    const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
      adapter: ADAPTER,
      payeeHandle: PAYEE_HANDLE,
      amountAda: Number(ESCROW_LOVELACE) / 1_000_000,
      fiatAmount: FIAT_AMOUNT,
      fiatCurrency: FIAT_CURRENCY,
    });
    console.log(`[initiate] intentId=${initiate.intentId}`);
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
      witnesses: {
        payeeSalt,
        amountSalt,
        note: "testnet demo witnesses; retained here so every commitment in this run is independently reproducible",
      },
      railQuote,
    };
  });
  const initiate = init.initiate;
  const railQuote = init.railQuote;

  // Stage 2: Cardano Preprod LOCK with the hardened datum.
  const lock = await stage("2-cardano-lock", async () => {
    const datum = {
      intentId: initiate.intentId,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
      deadline: BigInt(initiate.deadline) * 1000n, // POSIX ms
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
    if (escrowOutput.lovelace !== initiate.escrowLovelace.toString()) {
      throw new Error(
        `on-chain escrow lovelace ${escrowOutput.lovelace} does not match requested ${initiate.escrowLovelace}`,
      );
    }
    if (!escrowOutput.inlineDatum) throw new Error("on-chain escrow output has no inline datum");
    // Round-trip: decode the datum Blockfrost observed on-chain and compare.
    const decoded = decodeEscrowDatumCbor(escrowOutput.inlineDatum);
    const roundTripOk =
      decoded.intentId === datum.intentId &&
      decoded.payeeCommitment === datum.payeeCommitment &&
      decoded.amountCommitment === datum.amountCommitment &&
      decoded.adapterTag === datum.adapterTag &&
      decoded.deadline === datum.deadline &&
      decoded.circuitArtifactHash === datum.circuitArtifactHash &&
      decoded.senderPkh === datum.senderPkh &&
      decoded.operatorPkh === datum.operatorPkh &&
      decoded.oraclePublicKey === datum.oraclePublicKey;
    if (!roundTripOk) {
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
      onChainDatumRoundTripOk: roundTripOk,
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

  // Stage 3: Midnight devnet — deploy own contract, bind anchor, run intent proofs.
  const midnightIntent = await stage("3-midnight-intent", async () => {
    const proveStarted = Date.now();
    const receipt: MidnightIntentReceipt = await sdk.generateZKProof({
      intentId: initiate.intentId,
      cardanoLockAnchor: lockOutRef,
      payeeHandle: PAYEE_HANDLE,
      payeeSalt: init.witnesses.payeeSalt,
      fiatAmount: FIAT_AMOUNT,
      fiatCurrency: FIAT_CURRENCY,
      railQuoteDigest: railQuote.railQuoteDigest,
      principalLovelace: initiate.escrowLovelace,
      amountSalt: init.witnesses.amountSalt,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
    });
    const proveDurationMs = Date.now() - proveStarted;
    console.log(`[midnight] contract=${receipt.contractAddress} receiptHash=${receipt.receiptHash}`);
    const verify = await sdk.verifyZKProof(receipt, {
      intentId: initiate.intentId,
      cardanoLockAnchor: lockOutRef,
      payeeCommitment: initiate.payeeCommitment,
      amountCommitment: initiate.amountCommitment,
      adapterTag: initiate.adapterTag,
    });
    return { proveDurationMs, receipt, verify };
  });
  const intentReceipt = midnightIntent.receipt;

  // Stage 4: Revolut live sandbox payout + authenticated status to SETTLED.
  const payout = await stage("4-revolut-payout", async () => {
    const submitRes = await sdk.submitPayment({
      adapter: ADAPTER,
      intentId: initiate.intentId,
      proof: intentReceipt,
      payeeHandle: PAYEE_HANDLE,
      quote: railQuote,
    });
    console.log(`[revolut] railTxRef=${submitRes.railTxRef} status=${submitRes.providerStatus}`);
    const adapter = getAdapter(ADAPTER);
    const polls: RailStatusObservation[] = [];
    let finalStatus = submitRes.providerStatus;
    const pollDeadline = Date.now() + 3 * 60_000;
    while (finalStatus !== "SETTLED") {
      if (finalStatus === "FAILED") {
        throw new Error(`Revolut payout reached FAILED state: ${JSON.stringify(polls.at(-1) ?? submitRes)}`);
      }
      if (Date.now() > pollDeadline) {
        throw new Error(`Revolut payout did not settle within 180s (last status: ${finalStatus})`);
      }
      await sleep(5_000);
      const obs = await adapter.getStatus({
        intentId: initiate.intentId,
        providerReference: submitRes.providerReference,
      });
      polls.push(obs);
      finalStatus = obs.providerStatus;
      console.log(`[revolut] poll status=${obs.providerStatus} state=${obs.providerState}`);
    }
    // Always capture at least one authenticated observation for evidence.
    if (polls.length === 0) {
      const obs = await adapter.getStatus({
        intentId: initiate.intentId,
        providerReference: submitRes.providerReference,
      });
      polls.push(obs);
      if (obs.providerStatus !== "SETTLED") {
        throw new Error(`authenticated status is ${obs.providerStatus}, expected SETTLED`);
      }
    }
    return { submit: submitRes, statusPolls: polls, finalProviderStatus: "SETTLED" };
  });
  const railTxRef = (payout.submit as { railTxRef: string }).railTxRef;

  // Stage 5: settlement oracle attestation (same construction as the backend:
  // adapter-observed SETTLED → attestSettlement → self-verify).
  const oracleStage = await stage("5-oracle-attestation", async () => {
    const attestation = await sdk.confirmSettlement({
      intentId: initiate.intentId,
      railTxRef,
      status: "SETTLED",
    });
    console.log(`[oracle] settlementDigest=${attestation.settlementDigest}`);
    return {
      attestation,
      fingerprint: attestationFingerprint(attestation),
      digestInputs: {
        domain: "offramp:settlement:v1",
        intentId: initiate.intentId,
        railTxRef,
        status: "SETTLED",
        signedAt: attestation.signedAt,
      },
      derivation:
        "settlementDigest = sha256('offramp:settlement:v1' + '|' + intentId + '|' + railTxRef + '|' + status + '|' + signedAt); attestation body canonicalized (sorted keys) and Ed25519-signed with the operator oracle key (sdk/src/oracle/settlement-oracle.ts attestSettlement).",
      oraclePublicKey: operatorPublicKeyHex(),
    };
  });
  const attestation = oracleStage.attestation;

  // Stage 6: Midnight settlement proof on the SAME contract.
  const midnightSettlement = await stage("6-midnight-settlement", async () => {
    const started = Date.now();
    const receipt: MidnightSettlementReceipt = await sdk.generateSettlementReceipt({
      intentReceipt,
      settlementDigest: attestation.settlementDigest,
    });
    const settleDurationMs = Date.now() - started;
    console.log(`[midnight] settlement tx=${receipt.transaction.txId}`);
    const verify = await sdk.verifySettlementReceipt(receipt, {
      intentId: initiate.intentId,
      intentReceiptHash: intentReceipt.receiptHash,
      settlementDigest: attestation.settlementDigest,
      contractAddress: intentReceipt.contractAddress,
    });
    return { settleDurationMs, receipt, verify };
  });
  const settlementReceipt = midnightSettlement.receipt;

  // Stage 7: oracle signs the canonical ReleaseAuthorization for the exact
  // lock UTxO (two-step API: build canonical bytes, then sign them).
  const releaseAuth = await stage("7-release-authorization", async () => {
    const deadlineMs = initiate.deadline * 1000;
    const authorizationExpiry = BigInt(Math.min(deadlineMs, Date.now() + RELEASE_AUTH_WINDOW_MS));
    const body = {
      settlementDigest: attestation.settlementDigest,
      midnightSettlementReceiptHash: settlementReceipt.receiptHash,
      authorizationExpiry,
    };
    const authorizationMessageCbor = await releaseAuthorizationMessageForUtxo(
      operatorLucid,
      lockOutRef,
      body,
    );
    const oracleSignature = signReleaseAuthorization(authorizationMessageCbor);
    console.log(`[release-auth] message=${authorizationMessageCbor.slice(0, 64)}… sig=${oracleSignature.slice(0, 16)}…`);
    return {
      lockUtxo: lockOutRef,
      body,
      authorizationExpiryIso: new Date(Number(authorizationExpiry)).toISOString(),
      authorizationMessageCbor,
      oracleSignature,
      oraclePublicKey: operatorPublicKeyHex(),
      note: "authorizationMessageCbor is the exact canonical byte string signed by the oracle and re-derived on-chain by the Aiken validator (sdk/src/cardano/escrow_script.ts releaseAuthorizationMessageForUtxo).",
    };
  });

  // Stage 8: Cardano Preprod RELEASE (operator wallet spends escrow + pays fees).
  await stage("8-cardano-release", async () => {
    // Re-check operator funding depth right before the operator spends.
    const funding = await awaitTxConfirmed(OPERATOR_FUNDING_TX, { minConfirmations: 2 });
    const res = await withRetry("submitReleaseTx", () =>
      submitReleaseTx(operatorLucid, lockOutRef, {
        settlementDigest: attestation.settlementDigest,
        midnightSettlementReceiptHash: settlementReceipt.receiptHash,
        authorizationExpiry: releaseAuth.body.authorizationExpiry,
        oracleSignature: releaseAuth.oracleSignature,
      }),
    );
    console.log(`[release] submitted ${res.txHash}`);
    if (res.authorizationMessageCbor !== releaseAuth.authorizationMessageCbor) {
      throw new Error("release authorization message diverged between signing and submission");
    }
    const confirmation = await awaitTxConfirmed(res.txHash, { minConfirmations: 1 });
    const utxos = await txUtxos(res.txHash);
    const spendsEscrow = utxos.inputs.some(
      (i) => !i.collateral && i.tx_hash === lockOutRef.txHash && i.output_index === lockOutRef.outputIndex,
    );
    if (!spendsEscrow) throw new Error("release tx does not spend the expected escrow UTxO");
    // submitReleaseTx pays the escrow bundle to the ENTERPRISE address derived
    // from datum.operatorPkh (resolveEscrowUtxo → paymentAddressFromPkh).
    const operatorPayoutAddress = paymentAddressFromPkh("Preprod", operatorPkh);
    const escrowPayout = utxos.outputs.find(
      (o) =>
        !o.collateral &&
        o.address === operatorPayoutAddress &&
        o.amount.find((a) => a.unit === "lovelace")?.quantity === ESCROW_LOVELACE.toString(),
    );
    if (!escrowPayout) {
      throw new Error(
        `release outputs do not contain the exact ${ESCROW_LOVELACE} lovelace escrow payout to ${operatorPayoutAddress}: ${JSON.stringify(utxos.outputs)}`,
      );
    }
    return {
      txHash: res.txHash,
      spendsLockUtxo: `${lockOutRef.txHash}#${lockOutRef.outputIndex}`,
      operatorFundingConfirmationsAtRelease: funding.confirmations,
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
      explorer: explorerTx(res.txHash),
    };
  });

  evidence.completedAt = nowIso();
  evidence.result = "PASSED";
  writeEvidenceJson(EVIDENCE_JSON, evidence);
  writeEvidenceMarkdown(EVIDENCE_MD, renderMarkdown());
  console.log("\nE2E HAPPY PATH COMPLETE.");
  process.exit(0);
}

// ── Markdown rendering ───────────────────────────────────────────────────

function renderMarkdown(): string {
  const s = evidence.stages as Record<string, any>;
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
- Submit state: \`${pay.submit.raw.providerState}\` → authenticated status polls → **SETTLED** (provider state \`${pay.statusPolls.at(-1).providerState}\` at ${new Date(pay.statusPolls.at(-1).observedAt).toISOString()})

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
- authorizationExpiry: ${auth.authorizationExpiryIso}
- Canonical message (CBOR hex): \`${auth.authorizationMessageCbor.slice(0, 96)}…\` (full value in JSON)
- Oracle Ed25519 signature: \`${auth.oracleSignature}\`

## 8. Cardano RELEASE

- **Tx:** [\`${rel.txHash}\`](${rel.explorer})
- Spends escrow UTxO \`${rel.spendsLockUtxo}\`; pays the exact ${Number(ESCROW_LOVELACE) / 1e6} tADA escrow to the operator address (output #${rel.escrowPayoutToOperator.outputIndex}); fees paid from the operator's own UTxO
- Block ${rel.confirmation.blockHeight}, confirmed after ${Math.round(rel.confirmation.waitMs / 1000)}s

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
