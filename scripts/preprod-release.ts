/**
 * Submit a RELEASE tx that spends an escrow UTxO using the operator wallet.
 *
 *   npx tsx scripts/preprod-release.ts <lockTxHash> [outputIndex] [payoutAddress]
 *
 * Output index defaults to 0 (script payment is the first output of LOCK txs
 * built by `scripts/preprod-lock.ts`).
 * Payout address defaults to the operator wallet's own Bech32 address.
 *
 * The validator's `Release` redeemer requires the operator's payment key hash
 * to appear in `extra_signatories`, which is satisfied because the operator
 * wallet signs the tx and `addSignerKey(operatorPkh)` is set on the builder
 * (see `sdk/src/cardano/release.ts`).
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createAppLucid,
  submitReleaseTx,
  escrowScriptAddress,
} from "../sdk/src/index.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
const EVIDENCE_PATH = `${DATA_DIR}/preprod-evidence.json`;

async function main() {
  const lockTxHash = process.argv[2];
  if (!lockTxHash) {
    console.error("Usage: tsx scripts/preprod-release.ts <lockTxHash> [outputIndex] [payoutAddress]");
    process.exit(1);
  }
  const outputIndex = Number(process.argv[3] ?? "0");
  const payoutAddressOverride = process.argv[4];

  const lucid = await createAppLucid("operator");
  const network = lucid.config().network!;
  const scriptAddress = escrowScriptAddress(network);
  const operatorAddr = await lucid.wallet().address();
  const payoutAddress = payoutAddressOverride ?? operatorAddr;
  console.log("scriptAddress  =", scriptAddress);
  console.log("spending       =", lockTxHash + ":" + outputIndex);
  console.log("operatorAddr   =", operatorAddr);
  console.log("payoutAddress  =", payoutAddress);

  const res = await submitReleaseTx(
    lucid,
    { txHash: lockTxHash, outputIndex },
    payoutAddress,
    2_000_000n - 1_000_000n, // pay back the original min-ADA minus a fee buffer
  );
  console.log("RELEASE tx     =", res.txHash);
  console.log("explorer       = https://preprod.cardanoscan.io/transaction/" + res.txHash);

  if (existsSync(EVIDENCE_PATH)) {
    const arr = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>[];
    arr.push({
      kind: "RELEASE",
      txHash: res.txHash,
      spendsLockTx: lockTxHash,
      payoutAddress,
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
