/**
 * Shared helpers for the v2.0.0 REAL-infrastructure E2E evidence drivers:
 *   scripts/e2e-preprod.ts        (happy path: LOCK → Midnight → Revolut → RELEASE)
 *   scripts/e2e-preprod-refund.ts (refund path: LOCK → early-refund rejection → REFUND)
 *
 * Everything here talks to live services (Blockfrost Preprod, local Midnight
 * devnet) and records only observed values — nothing is fabricated.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// ── Blockfrost (Cardano Preprod) ─────────────────────────────────────────

export function blockfrostBase(): string {
  return process.env.BLOCKFROST_URL ?? "https://cardano-preprod.blockfrost.io/api/v0";
}

function blockfrostProjectId(): string {
  const pid = process.env.BLOCKFROST_PROJECT_ID || process.env.BLOCKFROST_API_KEY;
  if (!pid) throw new Error("BLOCKFROST_PROJECT_ID is not set");
  return pid;
}

export async function bfGet<T>(pathname: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${blockfrostBase()}${pathname}`, {
    headers: { project_id: blockfrostProjectId() },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

export interface BlockfrostTx {
  hash: string;
  block: string;
  block_height: number;
  block_time: number;
  slot: number;
  index: number;
  fees: string;
}

export interface BlockfrostTxUtxos {
  hash: string;
  inputs: Array<{
    address: string;
    tx_hash: string;
    output_index: number;
    amount: Array<{ unit: string; quantity: string }>;
    collateral?: boolean;
    reference?: boolean;
  }>;
  outputs: Array<{
    address: string;
    output_index: number;
    amount: Array<{ unit: string; quantity: string }>;
    inline_datum: string | null;
    data_hash: string | null;
    collateral?: boolean;
  }>;
}

export async function chainTip(): Promise<{ height: number; hash: string; time: number; slot: number }> {
  const { status, body } = await bfGet<{ height: number; hash: string; time: number; slot: number }>(
    "/blocks/latest",
  );
  if (status !== 200) throw new Error(`Blockfrost /blocks/latest returned HTTP ${status}`);
  return body;
}

/**
 * Wait until `txHash` is on-chain with at least `minConfirmations` (tip height
 * minus inclusion height). Polls Blockfrost; never fabricates values.
 */
export async function awaitTxConfirmed(
  txHash: string,
  opts?: { minConfirmations?: number; timeoutMs?: number; pollMs?: number },
): Promise<{ tx: BlockfrostTx; confirmations: number; waitMs: number }> {
  const minConfirmations = opts?.minConfirmations ?? 1;
  const timeoutMs = opts?.timeoutMs ?? 15 * 60_000;
  const pollMs = opts?.pollMs ?? 5_000;
  const started = Date.now();
  let tx: BlockfrostTx | undefined;
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`tx ${txHash} was not confirmed within ${timeoutMs}ms`);
    }
    if (!tx) {
      const { status, body } = await bfGet<BlockfrostTx>(`/txs/${txHash}`);
      if (status === 200) {
        tx = body;
      } else if (status !== 404) {
        console.log(`[awaitTx] Blockfrost /txs/${txHash.slice(0, 8)}… HTTP ${status}; retrying`);
      }
    }
    if (tx) {
      const tip = await chainTip();
      const confirmations = tip.height - tx.block_height;
      if (confirmations >= minConfirmations) {
        return { tx, confirmations, waitMs: Date.now() - started };
      }
      console.log(
        `[awaitTx] ${txHash.slice(0, 8)}… in block ${tx.block_height}; ${confirmations}/${minConfirmations} confirmations`,
      );
    } else {
      console.log(`[awaitTx] ${txHash.slice(0, 8)}… not yet on-chain (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    await sleep(pollMs);
  }
}

/** Fetch the resolved inputs/outputs of a confirmed tx. */
export async function txUtxos(txHash: string): Promise<BlockfrostTxUtxos> {
  const { status, body } = await bfGet<BlockfrostTxUtxos>(`/txs/${txHash}/utxos`);
  if (status !== 200) throw new Error(`Blockfrost /txs/${txHash}/utxos returned HTTP ${status}`);
  return body;
}

/** Locate the (unique) output of `txHash` paying `address`. */
export async function findOutputToAddress(
  txHash: string,
  address: string,
): Promise<{ outputIndex: number; lovelace: string; amount: Array<{ unit: string; quantity: string }>; inlineDatum: string | null }> {
  const utxos = await txUtxos(txHash);
  const matches = utxos.outputs.filter((o) => o.address === address);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one output of ${txHash} paying ${address}; found ${matches.length}`);
  }
  const out = matches[0];
  const lovelace = out.amount.find((a) => a.unit === "lovelace")?.quantity;
  if (!lovelace) throw new Error(`output ${txHash}#${out.output_index} has no lovelace amount`);
  return { outputIndex: out.output_index, lovelace, amount: out.amount, inlineDatum: out.inline_datum };
}

// ── Midnight local devnet health ─────────────────────────────────────────

export async function midnightNodeRpc<T>(origin: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(origin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Midnight node RPC ${method} returned HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Midnight node RPC ${method} failed: ${body.error.message}`);
  return body.result as T;
}

export async function midnightNodeHeight(origin: string): Promise<number> {
  const header = await midnightNodeRpc<{ number: string }>(origin, "chain_getHeader");
  return Number.parseInt(header.number, 16);
}

export async function midnightIndexerHeight(indexerHttp: string): Promise<number> {
  const res = await fetch(indexerHttp, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ block { height } }" }),
  });
  if (!res.ok) throw new Error(`Midnight indexer returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { block?: { height: number } }; errors?: Array<{ message?: string }> };
  if (body.errors?.length) {
    throw new Error(`Midnight indexer query failed: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  const h = body.data?.block?.height;
  if (typeof h !== "number") throw new Error("Midnight indexer returned no block height");
  return h;
}

/** Wait until the local Midnight indexer is within `maxGap` blocks of the node head. */
export async function awaitMidnightIndexerCatchUp(
  nodeOrigin: string,
  indexerHttp: string,
  opts?: { maxGap?: number; pollMs?: number; timeoutMs?: number },
): Promise<{ nodeHeight: number; indexerHeight: number; waitMs: number }> {
  const maxGap = opts?.maxGap ?? 2;
  const pollMs = opts?.pollMs ?? 5_000;
  const timeoutMs = opts?.timeoutMs ?? 30 * 60_000;
  const started = Date.now();
  for (;;) {
    const [node, idx] = await Promise.all([
      midnightNodeHeight(nodeOrigin),
      midnightIndexerHeight(indexerHttp),
    ]);
    const gap = node - idx;
    console.log(`[midnight catch-up] node=${node} indexer=${idx} gap=${gap}`);
    if (gap <= maxGap) return { nodeHeight: node, indexerHeight: idx, waitMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Midnight indexer did not catch up within ${timeoutMs}ms (gap=${gap})`);
    }
    await sleep(pollMs);
  }
}

// ── Generic helpers ──────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const TRANSIENT_ERROR_MARKERS = [
  "fetch failed",
  "timed out",
  "timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "socket hang up",
  "429",
  "500",
  "502",
  "503",
  "504",
  "mempool",
  "Mempool",
];

/**
 * Retry `fn` on transient network / Blockfrost-propagation errors only.
 * Deterministic validation errors surface immediately.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { attempts?: number; delayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? 15_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      const transient = TRANSIENT_ERROR_MARKERS.some((m) => message.includes(m));
      if (!transient || attempt === attempts) throw error;
      console.log(`[retry] ${label} attempt ${attempt}/${attempts} failed transiently: ${message.slice(0, 200)}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** JSON.stringify replacer: bigint → decimal string. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function writeEvidenceJson(filePath: string, evidence: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, jsonReplacer, 2)}\n`);
  console.log(`[evidence] wrote ${filePath}`);
}

export function writeEvidenceMarkdown(filePath: string, markdown: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, markdown);
  console.log(`[evidence] wrote ${filePath}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function explorerTx(txHash: string): string {
  return `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

/** Error → verbatim string (message + stack) for evidence files. */
export function errorVerbatim(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}
