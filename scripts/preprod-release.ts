import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createAppLucid,
  submitReleaseTx,
  releaseAuthorizationMessageForUtxo,
  escrowScriptAddress,
} from "../sdk/src/index.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
const EVIDENCE_PATH = `${DATA_DIR}/preprod-evidence.json`;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const lockTxHash = process.argv[2];
  if (!lockTxHash) {
    console.error("Usage: tsx scripts/preprod-release.ts <lockTxHash> [outputIndex]");
    console.error(
      "Requires SETTLEMENT_DIGEST, MIDNIGHT_SETTLEMENT_RECEIPT_HASH, and " +
      "AUTHORIZATION_EXPIRY_MS. Set ORACLE_RELEASE_SIGNATURE only after signing the printed message.",
    );
    process.exit(1);
  }
  const outputIndex = Number(process.argv[3] ?? "0");
  const authorizationBody = {
    settlementDigest: requiredEnv("SETTLEMENT_DIGEST"),
    midnightSettlementReceiptHash: requiredEnv("MIDNIGHT_SETTLEMENT_RECEIPT_HASH"),
    authorizationExpiry: BigInt(requiredEnv("AUTHORIZATION_EXPIRY_MS")),
  };

  const lucid = await createAppLucid("operator");
  const network = lucid.config().network!;
  const scriptAddress = escrowScriptAddress(network);
  const outRef = { txHash: lockTxHash, outputIndex };
  console.log("scriptAddress  =", scriptAddress);
  console.log("spending       =", lockTxHash + ":" + outputIndex);
  const authorizationMessageCbor = await releaseAuthorizationMessageForUtxo(
    lucid,
    outRef,
    authorizationBody,
  );
  console.log("auth message   =", authorizationMessageCbor);
  const oracleSignature = process.env.ORACLE_RELEASE_SIGNATURE?.trim();
  if (!oracleSignature) {
    console.log("No transaction submitted. Sign the auth message and set ORACLE_RELEASE_SIGNATURE.");
    return;
  }

  const res = await submitReleaseTx(
    lucid,
    outRef,
    { ...authorizationBody, oracleSignature },
  );
  console.log("RELEASE tx     =", res.txHash);
  console.log("auth message   =", res.authorizationMessageCbor);
  console.log("explorer       = https://preprod.cardanoscan.io/transaction/" + res.txHash);

  if (existsSync(EVIDENCE_PATH)) {
    const arr = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as Record<string, unknown>[];
    arr.push({
      kind: "RELEASE",
      txHash: res.txHash,
      spendsLockTx: lockTxHash,
      authorizationMessageCbor: res.authorizationMessageCbor,
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
