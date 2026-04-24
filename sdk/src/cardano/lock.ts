import type { AppLucid } from "./lucid_client.ts";
import { escrowDatumCbor, escrowScript, escrowScriptAddress, type EscrowDatumIn } from "./escrow_script.ts";

export interface LockResult {
  txHash: string;
  scriptAddress: string;
  lockLovelace: bigint;
  datumCbor: string;
}

/**
 * Build & submit the off-ramp LOCK transaction: pay `lockLovelace` ADA to the
 * escrow script with an inline `EscrowDatum` binding the intent. The sender's
 * own wallet signs.
 */
export async function submitLockTx(
  lucid: AppLucid,
  datum: EscrowDatumIn,
  lockLovelace: bigint,
): Promise<LockResult> {
  const script = escrowScript();
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const scriptAddress = escrowScriptAddress(network, script);
  const datumCbor = escrowDatumCbor(datum);

  const signed = await lucid
    .newTx()
    .pay.ToContract(scriptAddress, { kind: "inline", value: datumCbor }, { lovelace: lockLovelace })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  const txHash = await signed.submit();
  return { txHash, scriptAddress, lockLovelace, datumCbor };
}
