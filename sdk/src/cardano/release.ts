import type { AppLucid } from "./lucid_client.ts";
import {
  RELEASE_REDEEMER,
  escrowScript,
  escrowScriptAddress,
  paymentPkhFromAddress,
} from "./escrow_script.ts";

export interface ReleaseResult {
  txHash: string;
}

/**
 * Build & submit the RELEASE transaction: spend the escrow UTxO using the
 * operator's wallet. Validator path `Release` requires the operator signature
 * in `extra_signatories`.
 *
 * A future revision will additionally carry `(proof_bytes, public_inputs,
 * oracle_attestation)` in the redeemer so the validator can verify the ZK
 * proof + oracle attestation on-chain; the interface stays identical.
 */
export async function submitReleaseTx(
  lucid: AppLucid,
  scriptUtxoRef: { txHash: string; outputIndex: number },
  payoutAddress: string,
  payoutLovelace: bigint,
): Promise<ReleaseResult> {
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const script = escrowScript();
  const scriptAddress = escrowScriptAddress(network, script);
  const utxos = await lucid.utxosByOutRef([scriptUtxoRef]);
  if (utxos.length === 0) throw new Error("Escrow UTxO not found at script address: " + scriptAddress);
  const operatorAddr = await lucid.wallet().address();
  const operatorPkh = paymentPkhFromAddress(operatorAddr);

  const signed = await lucid
    .newTx()
    .collectFrom(utxos, RELEASE_REDEEMER)
    .attach.SpendingValidator(script)
    .addSignerKey(operatorPkh)
    .pay.ToAddress(payoutAddress, { lovelace: payoutLovelace })
    .complete()
    .then((tb) => tb.sign.withWallet().complete());

  return { txHash: await signed.submit() };
}
