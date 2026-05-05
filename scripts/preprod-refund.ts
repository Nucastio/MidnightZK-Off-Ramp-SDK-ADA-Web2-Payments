/**
 * Submit a REFUND tx that spends an escrow UTxO back to the sender wallet.
 *
 *   npx tsx scripts/preprod-refund.ts <lockTxHash> [outputIndex]
 *
 * Output index defaults to 0 (script payment is the first output of LOCK txs
 * built by `scripts/preprod-lock.ts`).
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createAppLucid,
  submitRefundTx,
  escrowScriptAddress,
} from "../sdk/src/index.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
const EVIDENCE_PATH = `${DATA_DIR}/preprod-evidence.json`;

async function main() {
  const lockTxHash = process.argv[2];
  if (!lockTxHash) {
    console.error("Usage: tsx scripts/preprod-refund.ts <lockTxHash> [outputIndex]");
    process.exit(1);
  }
  const outputIndex = Number(process.argv[3] ?? "0");

  const lucid = await createAppLucid("sender");
  const network = lucid.config().network!;
  const scriptAddress = escrowScriptAddress(network);
  console.log("scriptAddress =", scriptAddress);
  console.log("spending      =", lockTxHash + ":" + outputIndex);

  const res = await submitRefundTx(
    lucid,
    { txHash: lockTxHash, outputIndex },
    2_000_000n - 1_000_000n, // pay back original min-ADA minus fee buffer
  );
  console.log("REFUND tx     =", res.txHash);
  console.log("explorer      = https://preprod.cardanoscan.io/transaction/" + res.txHash);

  if (existsSync(EVIDENCE_PATH)) {
    const arr = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>[];
    arr.push({
      kind: "REFUND",
      txHash: res.txHash,
      spendsLockTx: lockTxHash,
      submittedAt: new Date().toISOString(),
      network: process.env.CARDANO_NETWORK ?? "Preprod",
    });
    writeFileSync(EVIDENCE_PATH, JSON.stringify(arr, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
