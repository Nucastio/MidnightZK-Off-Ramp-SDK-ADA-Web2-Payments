import type { AppLucid } from "./lucid_client.js";
import {
  escrowScript,
  paymentPkhFromAddress,
  posixTimeToNumber,
  releaseAuthorizationMessageCbor,
  releaseRedeemerCbor,
  resolveEscrowUtxo,
  validateReleaseAuthorization,
  type EscrowOutRef,
  type ReleaseAuthorizationIn,
} from "./escrow_script.js";

// Tolerance for a local clock running ahead of the chain tip. Configurable so
// emulator environments (whose slot zero is process start) can disable it.
// Read lazily: test files set the env var after module imports are hoisted.
function releaseClockSkewMs(): number {
  return Number(process.env.CARDANO_RELEASE_CLOCK_SKEW_MS ?? "120000");
}

export interface ReleaseResult {
  txHash: string;
  authorizationMessageCbor: string;
}

/**
 * Release the complete escrow asset bundle to the enterprise address derived
 * from the datum's operator key hash. Transaction fees must be supplied by a
 * separate operator-wallet input; none are deducted from the script input.
 */
export async function submitReleaseTx(
  lucid: AppLucid,
  scriptUtxoRef: EscrowOutRef,
  authorizationInput: ReleaseAuthorizationIn,
): Promise<ReleaseResult> {
  const authorization = validateReleaseAuthorization(authorizationInput);
  const resolved = await resolveEscrowUtxo(lucid, scriptUtxoRef);
  const operatorWalletAddress = await lucid.wallet().address();
  if (paymentPkhFromAddress(operatorWalletAddress) !== resolved.datum.operatorPkh) {
    throw new Error("connected wallet does not match escrow datum.operatorPkh");
  }

  const deadline = posixTimeToNumber("datum.deadline", resolved.datum.deadline);
  const authorizationExpiry = posixTimeToNumber(
    "authorization.authorizationExpiry",
    authorization.authorizationExpiry,
  );
  // Back-date validFrom to tolerate local clock skew ahead of the chain tip;
  // the validator only requires the interval to end before deadline/expiry.
  const validFrom = Date.now() - releaseClockSkewMs();
  const validTo = Math.min(deadline, authorizationExpiry);
  if (Date.now() >= validTo) {
    throw new Error("release authorization is expired or escrow deadline has been reached");
  }

  const authorizationMessageCbor = releaseAuthorizationMessageCbor(
    resolved.datum,
    scriptUtxoRef,
    authorization,
  );
  const redeemer = releaseRedeemerCbor(authorization);
  const script = escrowScript();
  const signed = await lucid
    .newTx()
    .collectFrom([resolved.utxo], redeemer)
    .attach.SpendingValidator(script)
    .addSigner(operatorWalletAddress)
    .validFrom(validFrom)
    .validTo(validTo)
    .pay.ToAddress(resolved.operatorAddress, { ...resolved.utxo.assets })
    .complete()
    .then((tx) => tx.sign.withWallet().complete());

  return { txHash: await signed.submit(), authorizationMessageCbor };
}
