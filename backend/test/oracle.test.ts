/**
 * Unit tests for the hardened Settlement Oracle module.
 *
 * Run: node --import tsx --test backend/test/
 *
 * Ordering matters: the fail-closed cases run before any signing call so the
 * module-level key cache is still cold.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { createHmac, verify as edVerify, createPublicKey } from "node:crypto";

delete process.env.RAIL_WEBHOOK_HMAC_KEY;
delete process.env.OPERATOR_ED25519_SK_HEX;

const oracle = await import("../../sdk/src/oracle/settlement-oracle.ts");

const SK_HEX = "8e3b1c5f0a7d2e94b6c81f3a05d49e2c7b16a8f0d4e5c3219b7f8a02e6d1c4f9";
const HMAC_KEY = "unit-test-hmac-key";

test("fails closed when RAIL_WEBHOOK_HMAC_KEY is unset (no dev default)", () => {
  assert.throws(
    () => oracle.verifyAdapterWebhook({ any: "payload" }, "00".repeat(32)),
    /RAIL_WEBHOOK_HMAC_KEY/,
  );
});

test("fails closed when OPERATOR_ED25519_SK_HEX is unset", () => {
  assert.throws(
    () => oracle.attestSettlement({ intentId: "aa".repeat(32), railTxRef: "ref-1", status: "SETTLED" }),
    /OPERATOR_ED25519_SK_HEX/,
  );
  assert.throws(() => oracle.signReleaseAuthorization("d8799f0102ff"), /OPERATOR_ED25519_SK_HEX/);
});

test("webhook HMAC verification round-trips and rejects tampering", () => {
  process.env.RAIL_WEBHOOK_HMAC_KEY = HMAC_KEY;
  const payload = { intent_id: "aa".repeat(32), status: "SETTLED" };
  const good = createHmac("sha256", HMAC_KEY).update(JSON.stringify(payload)).digest("hex");
  assert.equal(oracle.verifyAdapterWebhook(payload, good), true);
  const flipped = (good[0] === "0" ? "1" : "0") + good.slice(1);
  assert.equal(oracle.verifyAdapterWebhook(payload, flipped), false);
  assert.equal(oracle.verifyAdapterWebhook(payload, good.slice(0, 32)), false, "length mismatch rejected");
  assert.equal(oracle.verifyAdapterWebhook(payload, "not-hex-at-all!"), false, "non-hex rejected");
});

test("attestation round-trips; verifyAttestation recomputes the digest", () => {
  process.env.OPERATOR_ED25519_SK_HEX = SK_HEX;
  const att = oracle.attestSettlement({ intentId: "bb".repeat(32), railTxRef: "cashapp-ref-2", status: "SETTLED" });
  assert.equal(oracle.verifyAttestation(att), true);

  // Tampering with any signed field must fail verification.
  assert.equal(oracle.verifyAttestation({ ...att, status: "FAILED" }), false);
  assert.equal(oracle.verifyAttestation({ ...att, railTxRef: "cashapp-ref-other" }), false);
  assert.equal(oracle.verifyAttestation({ ...att, signedAt: att.signedAt + 1 }), false);

  // A caller-substituted digest that does not match the attested fields must
  // fail even though the signature itself is untouched elsewhere.
  assert.equal(oracle.verifyAttestation({ ...att, settlementDigest: "cc".repeat(32) }), false);

  // Malformed signature is rejected before any crypto call.
  assert.equal(oracle.verifyAttestation({ ...att, signature: "zz" }), false);
});

test("signReleaseAuthorization signs the exact message bytes with the operator key", () => {
  process.env.OPERATOR_ED25519_SK_HEX = SK_HEX;
  const messageHex = "d8799f4d4d49444e494748545f544553549fffff";
  const sigHex = oracle.signReleaseAuthorization(messageHex);
  assert.match(sigHex, /^[0-9a-f]{128}$/);

  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const pub = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(oracle.operatorPublicKeyHex(), "hex")]),
    format: "der",
    type: "spki",
  });
  assert.equal(edVerify(null, Buffer.from(messageHex, "hex"), pub, Buffer.from(sigHex, "hex")), true);
  assert.equal(edVerify(null, Buffer.from("d87980", "hex"), pub, Buffer.from(sigHex, "hex")), false);

  assert.throws(() => oracle.signReleaseAuthorization("not hex"), /hex/);
  assert.throws(() => oracle.signReleaseAuthorization("abc"), /hex/, "odd-length hex rejected");
});
