// In-process Cardano emulator E2E suite for the hardened escrow validator.
//
// Uses the @lucid-evolution Emulator provider (no network access) to exercise
// the real compiled validator from cardano/escrow/plutus.json through the SDK
// entry points: submitLockTx, releaseAuthorizationMessageForUtxo (two-step
// oracle signing), submitReleaseTx, and submitRefundTx. Negative on-chain
// cases are built with a manual Lucid transaction builder so the validator
// itself — not an SDK pre-flight guard — is what rejects them; every manual
// path has a positive control so failures cannot be vacuous.
//
// Emulator specifics (lucid-evolution 0.4.29):
// - slot length is fixed at 1000 ms, zeroTime is emulator.now() at Lucid();
// - awaitBlock(1) advances 20 slots and folds the mempool into the ledger;
// - deadlines derived from emulator.now() are always slot-aligned.

import assert from "node:assert/strict";
import test from "node:test";

// The emulator's slot zero is process start, so the mainnet clock-skew
// back-dating in release.ts would map to a negative slot. Disable it here.
process.env.CARDANO_RELEASE_CLOCK_SKEW_MS = "0";
import { randomBytes, generateKeyPairSync, sign as edSign } from "node:crypto";

import { Lucid, Emulator, generateEmulatorAccount } from "@lucid-evolution/lucid";

import {
  REFUND_REDEEMER,
  escrowScript,
  escrowScriptAddress,
  loadEscrowBlueprint,
  paymentAddressFromPkh,
  paymentPkhFromAddress,
  releaseAuthorizationMessageForUtxo,
  releaseRedeemerCbor,
  resolveEscrowUtxo,
} from "../dist/cardano/escrow_script.js";
import { submitLockTx } from "../dist/cardano/lock.js";
import { submitReleaseTx } from "../dist/cardano/release.js";
import { submitRefundTx } from "../dist/cardano/refund.js";

const NETWORK = "Custom";
const LOCK_LOVELACE = 25_000_000n;
const SCRIPT_FAILURE = /failed script execution/;

const randHex = (bytes) => randomBytes(bytes).toString("hex");

// --- test oracle keys (raw Ed25519, signed exactly like the backend oracle) ---
function makeOracleKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString(
    "hex",
  );
  return { publicKeyHex, privateKey };
}
const oracle = makeOracleKey();
const wrongOracle = makeOracleKey();
const signMessageHex = (messageHex, privateKey) =>
  edSign(null, Buffer.from(messageHex, "hex"), privateKey).toString("hex");

// --- emulated wallets and chain ---
const sender = generateEmulatorAccount({ lovelace: 1_000_000_000n });
const operator = generateEmulatorAccount({ lovelace: 1_000_000_000n });
const stranger = generateEmulatorAccount({ lovelace: 1_000_000_000n });
const emulator = new Emulator([sender, operator, stranger]);
const lucid = await Lucid(emulator, NETWORK);

const senderPkh = paymentPkhFromAddress(sender.address);
const operatorPkh = paymentPkhFromAddress(operator.address);
const script = escrowScript();
const scriptAddress = escrowScriptAddress(NETWORK, script);
const operatorPayoutAddress = paymentAddressFromPkh(NETWORK, operatorPkh);
const senderPayoutAddress = paymentAddressFromPkh(NETWORK, senderPkh);

function selectWallet(account) {
  lucid.selectWallet.fromSeed(account.seedPhrase);
}

/** Lock a fresh escrow from the sender wallet; returns its datum and out-ref. */
async function newEscrow({ deadlineOffsetMs = 3_600_000 } = {}) {
  selectWallet(sender);
  const datum = {
    intentId: randHex(32),
    payeeCommitment: randHex(32),
    amountCommitment: randHex(32),
    adapterTag: randHex(32),
    deadline: BigInt(emulator.now() + deadlineOffsetMs),
    circuitArtifactHash: randHex(32),
    senderPkh,
    operatorPkh,
    oraclePublicKey: oracle.publicKeyHex,
  };
  const { txHash } = await submitLockTx(lucid, datum, LOCK_LOVELACE);
  emulator.awaitBlock(1);
  const utxo = (await lucid.utxosAt(scriptAddress)).find((u) => u.txHash === txHash);
  assert.ok(utxo, "locked escrow UTxO must appear at the script address");
  assert.deepEqual(utxo.assets, { lovelace: LOCK_LOVELACE });
  return { datum, outRef: { txHash: utxo.txHash, outputIndex: utxo.outputIndex } };
}

/**
 * Two-step oracle authorization: (1) resolve the UTxO and build the canonical
 * release message via the SDK, (2) sign those exact bytes with Ed25519.
 */
async function signedAuthorizationFor(
  outRef,
  { expiryOffsetMs = 1_800_000, privateKey = oracle.privateKey } = {},
) {
  const body = {
    settlementDigest: randHex(32),
    midnightSettlementReceiptHash: randHex(32),
    authorizationExpiry: BigInt(emulator.now() + expiryOffsetMs),
  };
  const message = await releaseAuthorizationMessageForUtxo(lucid, outRef, body);
  return { ...body, oracleSignature: signMessageHex(message, privateKey) };
}

/** Manual release tx with full control over signer, payout, and validity. */
async function submitManualRelease(walletAccount, outRef, authorization, opts = {}) {
  selectWallet(walletAccount);
  const resolved = await resolveEscrowUtxo(lucid, outRef);
  const validFrom = opts.validFrom ?? emulator.now();
  const validTo = opts.validTo ?? emulator.now() + 120_000;
  const signed = await lucid
    .newTx()
    .collectFrom([resolved.utxo], releaseRedeemerCbor(authorization))
    .attach.SpendingValidator(script)
    .addSigner(opts.signerAddress ?? walletAccount.address)
    .validFrom(validFrom)
    .validTo(validTo)
    .pay.ToAddress(opts.payToAddress ?? resolved.operatorAddress, { ...resolved.utxo.assets })
    .complete()
    .then((tx) => tx.sign.withWallet().complete());
  const txHash = await signed.submit();
  emulator.awaitBlock(1);
  return txHash;
}

/** Manual refund tx with full control over signer and validity. */
async function submitManualRefund(walletAccount, outRef, opts = {}) {
  selectWallet(walletAccount);
  const resolved = await resolveEscrowUtxo(lucid, outRef);
  const validFrom = opts.validFrom ?? emulator.now();
  const validTo = opts.validTo ?? emulator.now() + 120_000;
  const signed = await lucid
    .newTx()
    .collectFrom([resolved.utxo], REFUND_REDEEMER)
    .attach.SpendingValidator(script)
    .addSigner(opts.signerAddress ?? walletAccount.address)
    .validFrom(validFrom)
    .validTo(validTo)
    .pay.ToAddress(opts.payToAddress ?? resolved.senderAddress, { ...resolved.utxo.assets })
    .complete()
    .then((tx) => tx.sign.withWallet().complete());
  const txHash = await signed.submit();
  emulator.awaitBlock(1);
  return txHash;
}

async function escrowStillLocked(outRef) {
  const utxos = await lucid.utxosByOutRef([outRef]);
  return utxos.length === 1;
}

// ---------------------------------------------------------------------------

test("emulator suite runs against the plutus.json v3 blueprint", () => {
  const blueprint = loadEscrowBlueprint();
  assert.equal(blueprint.preamble.plutusVersion, "v3");
  assert.ok(blueprint.validators.some((v) => v.title === "escrow.escrow.spend"));
});

test("valid oracle-authorized release by the operator pays full escrow value to the operator", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  selectWallet(operator);
  const { txHash } = await submitReleaseTx(lucid, outRef, authorization);
  emulator.awaitBlock(1);

  const payout = (await lucid.utxosAt(operatorPayoutAddress)).find((u) => u.txHash === txHash);
  assert.ok(payout, "release must create an output at the operator payout address");
  assert.deepEqual(payout.assets, { lovelace: LOCK_LOVELACE }, "full escrow value, no deductions");
  assert.equal(await escrowStillLocked(outRef), false, "escrow UTxO must be spent");
});

test("manual release control: a correctly built manual release also succeeds", async () => {
  // Positive control for every manual-builder negative below: proves the
  // manual path can pass the validator, so its failures are validator verdicts.
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  const txHash = await submitManualRelease(operator, outRef, authorization);
  const payout = (await lucid.utxosAt(operatorPayoutAddress)).find((u) => u.txHash === txHash);
  assert.deepEqual(payout?.assets, { lovelace: LOCK_LOVELACE });
});

test("release with a tampered settlement digest fails on-chain signature verification", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  selectWallet(operator);
  await assert.rejects(
    submitReleaseTx(lucid, outRef, { ...authorization, settlementDigest: randHex(32) }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release with a tampered oracle signature fails on-chain", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  const lastByte = authorization.oracleSignature.slice(-2);
  const flipped =
    authorization.oracleSignature.slice(0, -2) + (lastByte === "00" ? "01" : "00");
  selectWallet(operator);
  await assert.rejects(
    submitReleaseTx(lucid, outRef, { ...authorization, oracleSignature: flipped }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release whose redeemer expiry differs from the signed expiry fails on-chain", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  selectWallet(operator);
  await assert.rejects(
    submitReleaseTx(lucid, outRef, {
      ...authorization,
      authorizationExpiry: authorization.authorizationExpiry + 600_000n,
    }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release whose validity window extends past the authorization expiry fails on-chain", async () => {
  // Signature itself is valid; only the tx validity interval violates the
  // expiry, so this isolates the validator's interval check.
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef, { expiryOffsetMs: 60_000 });
  await assert.rejects(
    submitManualRelease(operator, outRef, authorization, {
      validFrom: emulator.now(),
      validTo: emulator.now() + 300_000, // past the 60 s expiry
    }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release with an already-expired authorization is refused by the SDK pre-flight guard", async () => {
  const { outRef } = await newEscrow();
  const expired = {
    settlementDigest: randHex(32),
    midnightSettlementReceiptHash: randHex(32),
    authorizationExpiry: BigInt(Date.now() - 1_000),
    oracleSignature: "00".repeat(64),
  };
  selectWallet(operator);
  await assert.rejects(
    submitReleaseTx(lucid, outRef, expired),
    /release authorization is expired or escrow deadline has been reached/,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("authorization signed for a different escrow UTxO cannot be replayed", async () => {
  const escrowA = await newEscrow();
  const escrowB = await newEscrow();
  const authorizationForA = await signedAuthorizationFor(escrowA.outRef);
  selectWallet(operator);
  // Replay against escrow B: message binds the spending out-ref, so it fails.
  await assert.rejects(
    submitReleaseTx(lucid, escrowB.outRef, authorizationForA),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(escrowB.outRef), true);
  // The same authorization is still good for the UTxO it was issued for.
  const { txHash } = await submitReleaseTx(lucid, escrowA.outRef, authorizationForA);
  emulator.awaitBlock(1);
  assert.ok(txHash);
  assert.equal(await escrowStillLocked(escrowA.outRef), false);
});

test("release authorized by the wrong oracle key fails on-chain", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef, {
    privateKey: wrongOracle.privateKey,
  });
  selectWallet(operator);
  await assert.rejects(submitReleaseTx(lucid, outRef, authorization), SCRIPT_FAILURE);
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release transaction signed by a non-operator fails on-chain", async () => {
  // Oracle authorization is genuine and full value goes to the operator, but
  // the tx is signed by a stranger: extra_signatories check must reject it.
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  await assert.rejects(
    submitManualRelease(stranger, outRef, authorization),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("release attempted from the sender wallet is refused by the SDK wallet guard", async () => {
  const { outRef } = await newEscrow();
  const authorization = await signedAuthorizationFor(outRef);
  selectWallet(sender);
  await assert.rejects(
    submitReleaseTx(lucid, outRef, authorization),
    /connected wallet does not match escrow datum\.operatorPkh/,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("refund before the deadline fails on-chain", async () => {
  // Manual tx because the SDK refuses to even build a pre-deadline refund
  // (it pins validFrom to the deadline); here the validity window sits
  // entirely before the deadline so the validator itself rejects it.
  const { outRef } = await newEscrow({ deadlineOffsetMs: 600_000 });
  await assert.rejects(
    submitManualRefund(sender, outRef, {
      validFrom: emulator.now(),
      validTo: emulator.now() + 60_000,
    }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("SDK refund before the deadline cannot enter the chain until the deadline slot", async () => {
  // The SDK builds a valid post-deadline tx (validFrom = deadline); the
  // emulator's slot check must refuse it while the chain is still early.
  const { outRef } = await newEscrow({ deadlineOffsetMs: 600_000 });
  selectWallet(sender);
  await assert.rejects(submitRefundTx(lucid, outRef), /not in slot range/);
  assert.equal(await escrowStillLocked(outRef), true);
});

test("refund transaction signed by a non-sender fails on-chain", async () => {
  const { outRef, datum } = await newEscrow({ deadlineOffsetMs: 60_000 });
  emulator.awaitSlot(120); // move well past the deadline
  await assert.rejects(
    submitManualRefund(stranger, outRef, {
      validFrom: Number(datum.deadline),
      validTo: Number(datum.deadline) + 300_000,
    }),
    SCRIPT_FAILURE,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("refund attempted from the operator wallet is refused by the SDK wallet guard", async () => {
  const { outRef } = await newEscrow({ deadlineOffsetMs: 60_000 });
  emulator.awaitSlot(120);
  selectWallet(operator);
  await assert.rejects(
    submitRefundTx(lucid, outRef),
    /connected wallet does not match escrow datum\.senderPkh/,
  );
  assert.equal(await escrowStillLocked(outRef), true);
});

test("refund after the deadline by the sender pays full escrow value back to the sender", async () => {
  const { outRef } = await newEscrow({ deadlineOffsetMs: 60_000 });
  emulator.awaitSlot(120); // emulator time control: cross the deadline
  selectWallet(sender);
  const { txHash } = await submitRefundTx(lucid, outRef);
  emulator.awaitBlock(1);

  const payout = (await lucid.utxosAt(senderPayoutAddress)).find((u) => u.txHash === txHash);
  assert.ok(payout, "refund must create an output at the sender payout address");
  assert.deepEqual(payout.assets, { lovelace: LOCK_LOVELACE }, "full escrow value, no deductions");
  assert.equal(await escrowStillLocked(outRef), false, "escrow UTxO must be spent");
});
