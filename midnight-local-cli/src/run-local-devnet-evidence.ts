/**
 * REAL end-to-end Midnight proof run against the LOCAL devnet (`undeployed`).
 *
 * Uses {@link MidnightLocalProofProvider} to:
 *   1. wait for the local indexer to catch up with the node head,
 *   2. deploy the strengthened `offramp` contract,
 *   3. bind a realistic Cardano lock anchor — the real Preprod LOCK tx hash
 *      recorded in `data/preprod-evidence.json` (witnesses reproduced via the
 *      SDK commitment helpers, anchor UTxO re-verified out-of-band),
 *   4. run the payee/amount(/compliance) binding proofs,
 *   5. derive a settlement digest through the SDK settlement oracle
 *      (`attestSettlement`, Ed25519-signed) and run the settlement proof,
 *   6. verify both receipts offline (canonical validation) and online
 *      (indexer tx metadata + finalized ledger state), and
 *   7. write machine-readable evidence to `data/midnight-local-devnet-evidence.json`.
 *
 * Env: `MIDNIGHT_DEPLOY_NETWORK=undeployed`, `BIP39_MNEMONIC` (funded on the
 * local devnet), `OPERATOR_ED25519_SK_HEX` (settlement oracle key).
 *
 * NOTE: This targets the LOCAL devnet (network id `undeployed`), NOT the
 * public Midnight testnet. The Cardano anchor is a real Preprod tx hash; the
 * rail transfer reference fed to the oracle is a demo value (no fiat moved).
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  adapterTag,
  amountCommitment,
  attestSettlement,
  payeeCommitment,
  validateIntentReceipt,
  validateSettlementReceipt,
  verifyAttestation,
  type Currency,
  type MidnightIntentReceipt,
  type MidnightSettlementReceipt,
} from "@nucast/midnightzk-offramp-sdk";
import { attestationFingerprint } from "@nucast/midnightzk-offramp-sdk/oracle/settlement-oracle";
import { OffRampMidnightConfig } from "./config.js";
import { MidnightLocalProofProvider } from "./midnight-proof-provider.js";

if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = process.env.OFFRAMP_DATA_DIR
  ? path.resolve(REPO_ROOT, process.env.OFFRAMP_DATA_DIR)
  : path.join(REPO_ROOT, "data");
const PREPROD_EVIDENCE_PATH = path.join(DATA_DIR, "preprod-evidence.json");
const WITNESS_OVERLAY_PATH = path.join(DATA_DIR, "preprod-lock-witnesses.local.json");
const OUT_PATH = path.join(DATA_DIR, "midnight-local-devnet-evidence.json");

/** Known payee handles used by the historical preprod lock scripts. */
const KNOWN_HANDLES: Record<string, string[]> = {
  cashapp: ["$preprod_demo_user", "$test_user_ca", "$alice"],
  wise: ["GB29NWBK60161331926819", "$preprod_demo_user"],
  revolut: ["@test_user_rv"],
};

interface PreprodLockRow {
  kind: string;
  adapter: string;
  txHash: string;
  scriptAddress: string;
  intentId: string;
  payeeCommitment: string;
  amountCommitment: string;
  /** Present in older revisions; may be redacted from the main evidence file. */
  payeeSalt?: string;
  amountSalt?: string;
  fiatAmount: string;
  fiatCurrency: string;
  railQuoteDigest: string;
  escrowLovelace: string;
  network: string;
  submittedAt: string;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function nodeRpc<T>(origin: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(origin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`node RPC ${method} returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`node RPC ${method} failed: ${body.error.message}`);
  return body.result as T;
}

async function nodeHeadHeight(origin: string): Promise<number> {
  const header = await nodeRpc<{ number: string }>(origin, "chain_getHeader");
  return Number.parseInt(header.number, 16);
}

async function indexerHeight(indexerHttp: string): Promise<number> {
  const res = await fetch(indexerHttp, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ block { height } }" }),
  });
  if (!res.ok) throw new Error(`indexer returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { block?: { height: number } };
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`indexer query failed: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  const h = body.data?.block?.height;
  if (typeof h !== "number") throw new Error("indexer returned no block height");
  return h;
}

async function waitForIndexerCatchUp(
  config: OffRampMidnightConfig,
  opts?: { maxGap?: number; pollMs?: number; timeoutMs?: number },
): Promise<{ nodeHeight: number; indexerHeight: number }> {
  const maxGap = opts?.maxGap ?? 2;
  const pollMs = opts?.pollMs ?? 5_000;
  const timeoutMs = opts?.timeoutMs ?? 45 * 60_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [node, idx] = await Promise.all([
      nodeHeadHeight(config.relayHttpOrigin),
      indexerHeight(config.indexer),
    ]);
    const gap = node - idx;
    console.log(`[catch-up] node=${node} indexer=${idx} gap=${gap}`);
    if (gap <= maxGap) return { nodeHeight: node, indexerHeight: idx };
    if (Date.now() > deadline) {
      throw new Error(`indexer did not catch up within ${timeoutMs}ms (gap=${gap})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

interface LockWitness {
  payeeHandle: string | null;
  payeeSalt: string;
  amountSalt: string;
}

/** Optional local witness overlay (salts redacted from the main evidence file). */
function loadWitnessOverlay(): Record<string, LockWitness> {
  try {
    const parsed = JSON.parse(readFileSync(WITNESS_OVERLAY_PATH, "utf8")) as {
      witnesses?: Record<string, LockWitness>;
    };
    return parsed.witnesses ?? {};
  } catch {
    return {};
  }
}

interface SelectedLock {
  lock: PreprodLockRow;
  payeeHandle: string;
  payeeSalt: string;
  amountSalt: string;
  witnessSource: string;
}

/**
 * Pick the preprod LOCK row whose payee AND amount commitments reproduce
 * exactly from the SDK helpers using a known payee handle. This guarantees the
 * witnesses fed to the Midnight circuits match the real on-chain Cardano lock.
 */
function selectAnchorLock(rows: PreprodLockRow[]): SelectedLock {
  const overlay = loadWitnessOverlay();
  const failures: string[] = [];
  const refundedTxs = new Set(
    rows.filter((r) => r.kind === "REFUND").map((r) => (r as any).spendsLockTx as string),
  );
  const locks = rows.filter((r) => r.kind === "LOCK");
  // Prefer locks whose escrow UTxO is still unspent (not refunded) on Cardano.
  const ordered = [
    ...locks.filter((l) => !refundedTxs.has(l.txHash)),
    ...locks.filter((l) => refundedTxs.has(l.txHash)),
  ];
  for (const lock of ordered) {
    const witness = overlay[lock.txHash];
    const payeeSalt = lock.payeeSalt ?? witness?.payeeSalt;
    const amountSalt = lock.amountSalt ?? witness?.amountSalt;
    const witnessSource = lock.payeeSalt !== undefined
      ? "data/preprod-evidence.json"
      : "data/preprod-lock-witnesses.local.json";
    if (!payeeSalt || !amountSalt) {
      failures.push(`${lock.txHash.slice(0, 8)} (${lock.adapter}): no witness salts available`);
      continue;
    }
    const handleCandidates = [
      ...(witness?.payeeHandle ? [witness.payeeHandle] : []),
      ...(KNOWN_HANDLES[lock.adapter] ?? []),
    ];
    for (const handle of handleCandidates) {
      const p = payeeCommitment(handle, payeeSalt);
      const a = amountCommitment({
        fiatAmount: lock.fiatAmount,
        fiatCurrency: lock.fiatCurrency,
        railQuoteDigest: lock.railQuoteDigest,
        principalLovelace: BigInt(lock.escrowLovelace),
        salt: amountSalt,
      });
      if (p.commitment === lock.payeeCommitment && a.commitment === lock.amountCommitment) {
        return { lock, payeeHandle: handle, payeeSalt, amountSalt, witnessSource };
      }
    }
    failures.push(`${lock.txHash.slice(0, 8)} (${lock.adapter}): commitments do not reproduce`);
  }
  throw new Error(
    `No preprod LOCK row reproduces its commitments from available witnesses; tried: ${failures.join("; ")}`,
  );
}

/**
 * Re-verify the anchor lock UTxO on Cardano Preprod via Blockfrost (when
 * credentials are configured). Returns the observed escrow output index, or a
 * record of why verification was skipped/failed. Never fabricates values.
 */
async function verifyAnchorOnCardano(lock: PreprodLockRow): Promise<Record<string, unknown>> {
  const projectId = process.env.BLOCKFROST_PROJECT_ID || process.env.BLOCKFROST_API_KEY;
  const base = process.env.BLOCKFROST_URL || "https://cardano-preprod.blockfrost.io/api/v0";
  if (!projectId) return { checked: false, reason: "no Blockfrost credentials configured" };
  try {
    const res = await fetch(`${base}/txs/${lock.txHash}/utxos`, {
      headers: { project_id: projectId },
    });
    if (!res.ok) return { checked: false, reason: `Blockfrost HTTP ${res.status}` };
    const body = (await res.json()) as {
      outputs: Array<{ output_index: number; address: string; amount: Array<{ unit: string; quantity: string }> }>;
    };
    const escrow = body.outputs.find((o) => o.address === lock.scriptAddress);
    if (!escrow) return { checked: true, escrowOutputFound: false };
    return {
      checked: true,
      escrowOutputFound: true,
      observedOutputIndex: escrow.output_index,
      observedLovelace: escrow.amount.find((a) => a.unit === "lovelace")?.quantity,
      observedAddress: escrow.address,
      source: `${base}/txs/${lock.txHash}/utxos`,
    };
  } catch (e) {
    return { checked: false, reason: `Blockfrost query failed: ${(e as Error).message}` };
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic) throw new Error("BIP39_MNEMONIC is required");

  const config = new OffRampMidnightConfig();
  if (config.networkId !== "undeployed") {
    throw new Error(
      `This evidence run targets the LOCAL devnet only; MIDNIGHT_DEPLOY_NETWORK resolved to '${config.networkId}'`,
    );
  }

  console.log("[env] endpoints:", {
    indexer: config.indexer,
    node: config.relayHttpOrigin,
    proofServer: config.proofServer,
    networkId: config.networkId,
  });

  const [systemChain, systemVersion, genesisHash] = await Promise.all([
    nodeRpc<string>(config.relayHttpOrigin, "system_chain"),
    nodeRpc<string>(config.relayHttpOrigin, "system_version"),
    nodeRpc<string>(config.relayHttpOrigin, "chain_getBlockHash", [0]),
  ]);
  console.log(`[env] chain='${systemChain}' node=${systemVersion} genesis=${genesisHash}`);

  console.log("[1/7] waiting for indexer catch-up…");
  const catchUp = await waitForIndexerCatchUp(config);

  console.log("[2/7] selecting real Cardano lock anchor from data/preprod-evidence.json…");
  const rows = JSON.parse(readFileSync(PREPROD_EVIDENCE_PATH, "utf8")) as PreprodLockRow[];
  const { lock, payeeHandle, payeeSalt, amountSalt, witnessSource } = selectAnchorLock(rows);
  const refunded = rows.some((r) => r.kind === "REFUND" && (r as any).spendsLockTx === lock.txHash);
  const anchorOnCardano = await verifyAnchorOnCardano(lock);
  console.log(
    `[anchor] preprod LOCK tx=${lock.txHash} outputIndex=0 adapter=${lock.adapter} refunded=${refunded}`,
    anchorOnCardano,
  );
  if (anchorOnCardano.checked === true && anchorOnCardano.observedOutputIndex !== 0) {
    throw new Error(
      `Anchor escrow output index observed on Cardano is ${String(anchorOnCardano.observedOutputIndex)}, expected 0`,
    );
  }

  const tag = adapterTag(lock.adapter);
  // Compliance mask: deterministic, documented derivation (sha256 of the
  // domain-separated jurisdiction string below). Both the public mask and the
  // private jurisdiction witness use this value (contract proves equality).
  const complianceMaskPreimage = `offramp:jurisdiction:v1|${lock.adapter}|${lock.fiatCurrency}`;
  const complianceMask = sha256Hex(Buffer.from(complianceMaskPreimage, "utf8"));

  console.log("[3/7] constructing MidnightLocalProofProvider (validates artifact manifest)…");
  const provider = new MidnightLocalProofProvider(config, mnemonic);
  console.log(`[artifacts] manifest hash = ${provider.artifactManifestHash}`);

  console.log("[4/7] generating intent receipt (deploy + bind + payee/amount/compliance proofs)…");
  const proveStarted = Date.now();
  const intentReceipt: MidnightIntentReceipt = await provider.generateIntentReceipt({
    intentId: lock.intentId,
    cardanoLockAnchor: { txHash: lock.txHash, outputIndex: 0 },
    payeeHandle,
    payeeSalt,
    fiatAmount: lock.fiatAmount,
    fiatCurrency: lock.fiatCurrency as Currency,
    railQuoteDigest: lock.railQuoteDigest,
    principalLovelace: BigInt(lock.escrowLovelace),
    amountSalt,
    payeeCommitment: lock.payeeCommitment,
    amountCommitment: lock.amountCommitment,
    adapterTag: tag,
    complianceMask,
  });
  const proveDurationMs = Date.now() - proveStarted;
  console.log(
    `[intent] contract=${intentReceipt.contractAddress} receiptHash=${intentReceipt.receiptHash} (${proveDurationMs}ms)`,
  );

  const expectedIntent = {
    intentId: lock.intentId,
    cardanoLockAnchor: { txHash: lock.txHash, outputIndex: 0 },
    payeeCommitment: lock.payeeCommitment,
    amountCommitment: lock.amountCommitment,
    adapterTag: tag,
    complianceFlag: complianceMask,
  };

  console.log("[5/7] verifying intent receipt offline + online…");
  const intentOffline = validateIntentReceipt(intentReceipt, expectedIntent);
  console.log("[verify intent offline]", intentOffline);
  const intentOnline = await provider.verifyIntentReceipt(intentReceipt, expectedIntent);
  console.log("[verify intent online]", intentOnline);
  if (!intentOffline.ok || !intentOnline.ok) {
    throw new Error(
      `intent receipt verification failed: offline=${JSON.stringify(intentOffline)} online=${JSON.stringify(intentOnline)}`,
    );
  }

  console.log("[6/7] oracle attestation + settlement proof…");
  // Demo rail transfer reference — no real fiat moved for this local devnet
  // run; the oracle signs it deterministically with OPERATOR_ED25519_SK_HEX.
  const railTxRef = `wise:demo-local-devnet:${lock.intentId.slice(0, 16)}`;
  const attestation = attestSettlement({
    intentId: lock.intentId,
    railTxRef,
    status: "SETTLED",
  });
  if (!verifyAttestation(attestation)) {
    throw new Error("oracle attestation Ed25519 signature failed verification");
  }
  console.log(
    `[oracle] settlementDigest=${attestation.settlementDigest} fingerprint=${attestationFingerprint(attestation)}`,
  );

  const settleStarted = Date.now();
  const settlementReceipt: MidnightSettlementReceipt = await provider.generateSettlementReceipt({
    intentReceipt,
    settlementDigest: attestation.settlementDigest,
  });
  const settleDurationMs = Date.now() - settleStarted;
  console.log(
    `[settlement] tx=${settlementReceipt.transaction.txId} receiptHash=${settlementReceipt.receiptHash} (${settleDurationMs}ms)`,
  );

  const expectedSettlement = {
    intentId: lock.intentId,
    intentReceiptHash: intentReceipt.receiptHash,
    settlementDigest: attestation.settlementDigest,
    contractAddress: intentReceipt.contractAddress,
  };
  const settlementOffline = validateSettlementReceipt(settlementReceipt, expectedSettlement);
  console.log("[verify settlement offline]", settlementOffline);
  const settlementOnline = await provider.verifySettlementReceipt(settlementReceipt, expectedSettlement);
  console.log("[verify settlement online]", settlementOnline);
  if (!settlementOffline.ok || !settlementOnline.ok) {
    throw new Error(
      `settlement receipt verification failed: offline=${JSON.stringify(settlementOffline)} online=${JSON.stringify(settlementOnline)}`,
    );
  }

  console.log("[7/7] writing evidence…");
  const finalHeights = await Promise.all([
    nodeHeadHeight(config.relayHttpOrigin),
    indexerHeight(config.indexer),
  ]);

  const evidence = {
    kind: "MIDNIGHT_LOCAL_DEVNET_E2E",
    version: 1,
    generatedAt: { startedAt, completedAt: new Date().toISOString() },
    environment: {
      note: "LOCAL Midnight devnet (network id 'undeployed') — NOT the public Midnight testnet.",
      midnightNetworkId: config.networkId,
      systemChain,
      nodeVersion: systemVersion,
      nodeImage: "midnightntwrk/midnight-node:0.22.1",
      indexerImage: "midnightntwrk/indexer-standalone:4.0.0",
      proofServerImage: "midnightntwrk/proof-server:8.0.3",
      genesisHash,
      endpoints: {
        node: config.relayHttpOrigin,
        indexer: config.indexer,
        proofServer: config.proofServer,
      },
      indexerCatchUp: {
        atRunStart: catchUp,
        atRunEnd: { nodeHeight: finalHeights[0], indexerHeight: finalHeights[1] },
      },
    },
    artifactManifestHash: provider.artifactManifestHash,
    cardanoLockAnchor: {
      source: "data/preprod-evidence.json",
      network: lock.network,
      adapter: lock.adapter,
      txHash: lock.txHash,
      outputIndex: 0,
      outputIndexNote:
        "submitLockTx pays the escrow script as the first tx output (sdk/src/cardano/lock.ts); see onCardanoVerification for the live Blockfrost re-check performed during this run.",
      onCardanoVerification: anchorOnCardano,
      scriptAddress: lock.scriptAddress,
      escrowLovelace: lock.escrowLovelace,
      lockSubmittedAt: lock.submittedAt,
      refundedOnCardano: refunded,
      explorer: `https://preprod.cardanoscan.io/transaction/${lock.txHash}`,
      commitmentReproduction: {
        payeeHandle,
        witnessSource,
        payeeCommitmentMatches: true,
        amountCommitmentMatches: true,
        note: "payee/amount commitments recomputed with SDK payeeCommitment()/amountCommitment() from the recorded salts, fiat quote and principal; both equal the on-chain datum commitments. Salts themselves are not included in this evidence file.",
      },
    },
    publicInputs: {
      intentId: lock.intentId,
      payeeCommitment: lock.payeeCommitment,
      amountCommitment: lock.amountCommitment,
      adapterTag: tag,
      complianceMask,
      complianceMaskDerivation: `sha256(utf8("${complianceMaskPreimage}"))`,
    },
    oracleAttestation: {
      ...attestation,
      fingerprint: attestationFingerprint(attestation),
      digestDerivation:
        "settlementDigest = sha256('offramp:settlement:v1' | '|' | intentId | '|' | railTxRef | '|' | status | '|' | signedAt) via SDK settlementDigest(); signed Ed25519 by the operator oracle key (attestSettlement).",
      railTxRefNote:
        "Demo rail transfer reference for the local devnet run — no real fiat transfer occurred.",
    },
    intentReceipt,
    settlementReceipt,
    verification: {
      intent: { offline: intentOffline, online: intentOnline },
      settlement: { offline: settlementOffline, online: settlementOnline },
      proveDurationMs,
      settleDurationMs,
    },
    decodedLedgerState: {
      afterIntent: intentReceipt.publicState,
      afterSettlement: settlementReceipt.publicState,
    },
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log("Wrote", OUT_PATH);
  console.log("DONE: all proofs finalized and verified on the LOCAL devnet.");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
