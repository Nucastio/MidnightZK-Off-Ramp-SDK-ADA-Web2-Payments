import type { AppLucid } from "./lucid_client.js";
import {
  REFUND_REDEEMER,
  escrowScript,
  paymentPkhFromAddress,
  posixTimeToNumber,
  resolveEscrowUtxo,
  type EscrowOutRef,
} from "./escrow_script.js";

const REFUND_VALIDITY_WINDOW_MS = 10 * 60 * 1000;

// Tolerance for a local clock running ahead of the chain tip — same knob as
// release.ts so the emulator suite (slot zero = process start) can disable it.
// Read lazily: test files set the env var after module imports are hoisted.
function clockSkewMs(): number {
  return Number(process.env.CARDANO_RELEASE_CLOCK_SKEW_MS ?? "120000");
}

export interface RefundResult {
  txHash: string;
}

/**
 * Refund the complete escrow asset bundle to the enterprise address derived
 * from the datum's sender key hash. The validity interval starts at or after
 * the pinned deadline, and fees must come from a separate sender-wallet input.
 */
export async function submitRefundTx(
  lucid: AppLucid,
  scriptUtxoRef: EscrowOutRef,
): Promise<RefundResult> {
  const resolved = await resolveEscrowUtxo(lucid, scriptUtxoRef);
  const senderWalletAddress = await lucid.wallet().address();
  if (paymentPkhFromAddress(senderWalletAddress) !== resolved.datum.senderPkh) {
    throw new Error("connected wallet does not match escrow datum.senderPkh");
  }

  const deadline = posixTimeToNumber("datum.deadline", resolved.datum.deadline);
  // Back-date validFrom to tolerate local clock skew ahead of the chain tip,
  // clamped so the interval never starts before the datum deadline (the
  // validator's refund time-lock requires validFrom >= deadline).
  const validFrom = Math.max(Date.now() - clockSkewMs(), deadline);
  const validTo = validFrom + REFUND_VALIDITY_WINDOW_MS;
  if (!Number.isSafeInteger(validTo)) throw new Error("refund validity bound exceeds safe integer range");

  const script = escrowScript();
  const signed = await lucid
    .newTx()
    .collectFrom([resolved.utxo], REFUND_REDEEMER)
    .attach.SpendingValidator(script)
    .addSigner(senderWalletAddress)
    .validFrom(validFrom)
    .validTo(validTo)
    .pay.ToAddress(resolved.senderAddress, { ...resolved.utxo.assets })
    .complete()
    .then((tx) => tx.sign.withWallet().complete());

  return { txHash: await signed.submit() };
}
