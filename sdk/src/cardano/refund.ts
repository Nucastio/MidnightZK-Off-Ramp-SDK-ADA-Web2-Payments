import type { AppLucid } from "./lucid_client.ts";
import {
  REFUND_REDEEMER,
  escrowScript,
  escrowScriptAddress,
} from "./escrow_script.ts";

export interface RefundResult {
  txHash: string;
}

/**
 * Build & submit the REFUND transaction: spend the escrow UTxO back to the
 * sender wallet. Validator path `Refund` requires the sender's signature in
 * `extra_signatories` (after the deadline in production — the current build
 * lets the wallet decide when to retry).
 */
export async function submitRefundTx(
  lucid: AppLucid,
  scriptUtxoRef: { txHash: string; outputIndex: number },
  refundLovelace: bigint,
): Promise<RefundResult> {
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const script = escrowScript();
  const scriptAddress = escrowScriptAddress(network, script);
  const utxos = await lucid.utxosByOutRef([scriptUtxoRef]);
  if (utxos.length === 0) throw new Error("Escrow UTxO not found at script address: " + scriptAddress);
  const senderAddr = await lucid.wallet().address();

  // See `release.ts` for why we use `addSigner(addr)` instead of
  // `addSignerKey(pkh)` (LE 0.4.29 wasm bug on PlutusV3 spends).
  const signed = await lucid
    .newTx()
    .collectFrom(utxos, REFUND_REDEEMER)
    .attach.SpendingValidator(script)
    .addSigner(senderAddr)
    .pay.ToAddress(senderAddr, { lovelace: refundLovelace })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  return { txHash: await signed.submit() };
}
