/**
 * Submit a real LOCK tx to the escrow validator on Cardano Preprod.
 *
 *   npx tsx scripts/preprod-lock.ts [adapter] [payeeHandle] [fiatAmount] [fiatCurrency]
 *
 * Prints the txHash + script address + Cardanoscan link. Saves the
 * Preprod-evidence row to data/preprod-evidence.json so the testnet-evidence
 * doc / API can pick it up.
 */
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import {
  OffRampSDK,
  createAppLucid,
  paymentPkhFromAddress,
  submitLockTx,
  escrowScriptAddress,
} from "../sdk/src/index.ts";
import type { Currency, RailId } from "../sdk/src/types.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
const EVIDENCE_PATH = `${DATA_DIR}/preprod-evidence.json`;

function appendEvidence(row: Record<string, unknown>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  let arr: Record<string, unknown>[] = [];
  if (existsSync(EVIDENCE_PATH)) {
    arr = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  }
  arr.push(row);
  writeFileSync(EVIDENCE_PATH, JSON.stringify(arr, null, 2));
}

async function main() {
  const adapter = (process.argv[2] ?? "cashapp") as RailId;
  const payeeHandle = process.argv[3] ?? "$preprod_demo_user";
  const fiatAmount = process.argv[4] ?? "1.50";
  const fiatCurrency = (process.argv[5] ?? "USD") as Currency;

  const lucid = await createAppLucid("sender");
  const senderAddr = await lucid.wallet().address();
  const senderPkh = paymentPkhFromAddress(senderAddr);
  const operatorPkh = senderPkh; // single-seed demo

  const sdk = new OffRampSDK({ senderPkh, operatorPkh });
  const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
    adapter,
    payeeHandle,
    amountAda: 2,
    fiatAmount,
    fiatCurrency,
  });

  console.log("intentId        =", initiate.intentId);
  console.log("payeeCommitment =", initiate.payeeCommitment);
  console.log("amountCommitment=", initiate.amountCommitment);
  console.log("adapterTag      =", initiate.adapterTag);
  console.log("vkHash          =", initiate.vkHash);
  console.log("senderPkh       =", senderPkh);

  const datum = {
    intentId: initiate.intentId,
    payeeCommitment: initiate.payeeCommitment,
    amountCommitment: initiate.amountCommitment,
    adapterTag: initiate.adapterTag,
    deadline: BigInt(initiate.deadline) * 1000n,
    vkHash: initiate.vkHash,
    senderPkh,
    operatorPkh,
  };

  const res = await submitLockTx(lucid, datum, initiate.escrowLovelace);
  console.log("\nLOCK tx submitted:");
  console.log("  txHash        =", res.txHash);
  console.log("  scriptAddress =", res.scriptAddress);
  console.log("  explorer      = https://preprod.cardanoscan.io/transaction/" + res.txHash);

  appendEvidence({
    kind: "LOCK",
    adapter,
    txHash: res.txHash,
    scriptAddress: res.scriptAddress,
    intentId: initiate.intentId,
    payeeCommitment: initiate.payeeCommitment,
    amountCommitment: initiate.amountCommitment,
    submittedAt: new Date().toISOString(),
    payeeSalt,
    amountSalt,
    fiatAmount,
    fiatCurrency,
    railQuoteDigest: railQuote.railQuoteDigest,
    escrowLovelace: initiate.escrowLovelace.toString(),
    network: process.env.CARDANO_NETWORK ?? "Preprod",
    senderPkh,
    operatorPkh,
    deadline: initiate.deadline,
  });
  console.log("\nWrote " + EVIDENCE_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
