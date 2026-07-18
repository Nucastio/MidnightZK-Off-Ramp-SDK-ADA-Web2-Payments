import type { AppLucid } from "./lucid_client.js";
import {
  escrowDatumCbor,
  escrowScript,
  escrowScriptAddress,
  paymentPkhFromAddress,
  validateEscrowDatum,
  type EscrowDatumIn,
} from "./escrow_script.js";

export interface LockResult {
  txHash: string;
  scriptAddress: string;
  lockLovelace: bigint;
  datumCbor: string;
}

/**
 * Lock ADA at the escrow script with a validated inline datum. The selected
 * wallet must own the payment key hash pinned as `senderPkh`.
 */
export async function submitLockTx(
  lucid: AppLucid,
  datumInput: EscrowDatumIn,
  lockLovelace: bigint,
): Promise<LockResult> {
  if (lockLovelace <= 0n) throw new Error("lockLovelace must be positive");
  const datum = validateEscrowDatum(datumInput);
  const senderAddress = await lucid.wallet().address();
  if (paymentPkhFromAddress(senderAddress) !== datum.senderPkh) {
    throw new Error("connected wallet does not match datum.senderPkh");
  }

  const script = escrowScript();
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const scriptAddress = escrowScriptAddress(network, script);
  const datumCbor = escrowDatumCbor(datum);

  const signed = await lucid
    .newTx()
    .pay.ToContract(scriptAddress, { kind: "inline", value: datumCbor }, { lovelace: lockLovelace })
    .complete()
    .then((tx) => tx.sign.withWallet().complete());

  const txHash = await signed.submit();
  return { txHash, scriptAddress, lockLovelace, datumCbor };
}
