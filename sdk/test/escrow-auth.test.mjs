import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeEscrowDatumCbor,
  escrowDatumCbor,
  releaseAuthorizationMessageCbor,
  releaseRedeemerCbor,
} from "../dist/cardano/escrow_script.js";

const datum = {
  intentId: "11".repeat(32),
  payeeCommitment: "22".repeat(32),
  amountCommitment: "33".repeat(32),
  adapterTag: "44".repeat(32),
  deadline: 2_000_000n,
  circuitArtifactHash: "55".repeat(32),
  senderPkh: "66".repeat(28),
  operatorPkh: "77".repeat(28),
  oraclePublicKey: "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
};
const authorization = {
  settlementDigest: "99".repeat(32),
  midnightSettlementReceiptHash: "bb".repeat(32),
  authorizationExpiry: 1_900_000n,
  oracleSignature:
    "6d82fa9bacc32df378a5b8b03cc1c5168e9c6bf0922b6fb51b2520f72b57a3bc" +
    "8977df44befe9f4a97d75783c7243b93d6656339788ce88397abf4951defdd01",
};

const expectedMessage =
  "d8799f581b4d49444e494748545f4f464652414d505f52454c454153455f5631" +
  "5820" + "11".repeat(32) +
  "5820" + "22".repeat(32) +
  "5820" + "33".repeat(32) +
  "5820" + "44".repeat(32) +
  "1a001e8480" +
  "5820" + "55".repeat(32) +
  "581c" + "66".repeat(28) +
  "581c" + "77".repeat(28) +
  "582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8" +
  "5820" + "aa".repeat(32) +
  "03" +
  "5820" + "99".repeat(32) +
  "5820" + "bb".repeat(32) +
  "1a001cfde0ff";

test("canonical release message matches the Aiken known vector", () => {
  assert.equal(
    releaseAuthorizationMessageCbor(datum, { txHash: "aa".repeat(32), outputIndex: 3 }, authorization),
    expectedMessage,
  );
});

test("escrow datum round-trips all pinned fields", () => {
  assert.deepEqual(decodeEscrowDatumCbor(escrowDatumCbor(datum)), datum);
});

test("release redeemer and encoders reject malformed byte lengths", () => {
  assert.throws(
    () => releaseRedeemerCbor({ ...authorization, oracleSignature: "00" }),
    /oracleSignature must be exactly 64 bytes/,
  );
  assert.throws(
    () => escrowDatumCbor({ ...datum, senderPkh: "00" }),
    /senderPkh must be exactly 28 bytes/,
  );
});
