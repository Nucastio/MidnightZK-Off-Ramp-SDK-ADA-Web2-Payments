/**
 * Settlement Oracle (TAD §7.5).
 *
 * Ingests rail-adapter webhook payloads, verifies the adapter HMAC, then emits
 * a canonical signed attestation bound to `intent_id`. Signature is Ed25519
 * over the deterministic JSON canonicalization of the attestation body using
 * the operator key from `OPERATOR_ED25519_SK_HEX`.
 *
 * Security posture:
 *  - No development-secret defaults: both `RAIL_WEBHOOK_HMAC_KEY` and
 *    `OPERATOR_ED25519_SK_HEX` are required; every entry point fails closed
 *    when they are absent.
 *  - All MAC / digest comparisons are constant-time.
 *  - `verifyAttestation` recomputes the settlement digest from the attested
 *    fields; a signature over a mismatched digest never verifies.
 *  - The signed attestation body already binds the provider reference via
 *    `rail_tx_ref` (the `OracleAttestation` type carries no further adapter
 *    fields, and the Aiken-side release-authorization message format is owned
 *    by `cardano/escrow_script` and is reused unchanged here).
 */
import {
  createHash,
  createHmac,
  sign as edSign,
  verify as edVerify,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  KeyObject,
} from "node:crypto";
import { settlementDigest } from "../commitments.js";
import type { OracleAttestation } from "../types.js";

function adapterHmacKey(): string {
  const key = process.env.RAIL_WEBHOOK_HMAC_KEY?.trim();
  if (!key) {
    throw new Error("RAIL_WEBHOOK_HMAC_KEY is not configured; refusing to verify adapter webhooks (fail closed)");
  }
  return key;
}

function sk32(): Buffer {
  const hex = (process.env.OPERATOR_ED25519_SK_HEX ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("OPERATOR_ED25519_SK_HEX must be 32-byte hex (64 chars); refusing to sign (fail closed)");
  }
  return Buffer.from(hex, "hex");
}

function ed25519PrivateFromSeed(seed: Buffer): KeyObject {
  // RFC 8410 PKCS#8 wrapper for Ed25519 private key from 32-byte seed.
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const der = Buffer.concat([prefix, seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

let cachedPriv: KeyObject | null = null;
let cachedPub: KeyObject | null = null;
function keys(): { priv: KeyObject; pub: KeyObject } {
  if (!cachedPriv) {
    cachedPriv = ed25519PrivateFromSeed(sk32());
    cachedPub = createPublicKey(cachedPriv);
  }
  return { priv: cachedPriv, pub: cachedPub! };
}

export function operatorPublicKeyHex(): string {
  const { pub } = keys();
  const der = pub.export({ type: "spki", format: "der" }) as Buffer;
  // The last 32 bytes of an Ed25519 SPKI DER are the raw public key.
  return der.subarray(der.length - 32).toString("hex");
}

/** Constant-time comparison of two hex strings (length mismatch is not secret). */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function verifyAdapterWebhook(payload: Record<string, unknown>, providedHmac: string): boolean {
  const expected = createHmac("sha256", adapterHmacKey())
    .update(JSON.stringify(payload))
    .digest("hex");
  return constantTimeHexEqual(expected, providedHmac);
}

function canonicalize(obj: Record<string, unknown>): string {
  // Stable JSON: sorted keys, no whitespace.
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + JSON.stringify(obj[k])).join(",") + "}";
}

function attestationBody(att: {
  intentId: string;
  railTxRef: string;
  status: "SETTLED" | "FAILED";
  settlementDigest: string;
  signedAt: number;
}): Record<string, unknown> {
  return {
    intent_id: att.intentId,
    rail_tx_ref: att.railTxRef,
    status: att.status,
    settlement_digest: att.settlementDigest,
    signed_at: att.signedAt,
  };
}

export function attestSettlement(input: {
  intentId: string;
  railTxRef: string;
  status: "SETTLED" | "FAILED";
}): OracleAttestation {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = settlementDigest({ ...input, signedAt });
  const body = attestationBody({ ...input, settlementDigest: digest, signedAt });
  const { priv } = keys();
  const sig = edSign(null, Buffer.from(canonicalize(body), "utf8"), priv);
  return {
    intentId: input.intentId,
    status: input.status,
    railTxRef: input.railTxRef,
    settlementDigest: digest,
    signature: sig.toString("hex"),
    signedAt,
  };
}

export function verifyAttestation(att: OracleAttestation): boolean {
  if (att.status !== "SETTLED" && att.status !== "FAILED") return false;
  if (!Number.isSafeInteger(att.signedAt) || att.signedAt < 0) return false;
  if (!/^[0-9a-f]{128}$/i.test(att.signature ?? "")) return false;
  // Recompute the settlement digest from the attested fields — a signature over
  // a caller-supplied digest that does not match the fields must never verify.
  const recomputed = settlementDigest({
    intentId: att.intentId,
    railTxRef: att.railTxRef,
    status: att.status,
    signedAt: att.signedAt,
  });
  if (!constantTimeHexEqual(recomputed, att.settlementDigest ?? "")) return false;
  const body = attestationBody({
    intentId: att.intentId,
    railTxRef: att.railTxRef,
    status: att.status,
    settlementDigest: recomputed,
    signedAt: att.signedAt,
  });
  const { pub } = keys();
  return edVerify(null, Buffer.from(canonicalize(body), "utf8"), pub, Buffer.from(att.signature, "hex"));
}

/**
 * Ed25519-sign the exact release-authorization message bytes produced by
 * `releaseAuthorizationMessageCbor` (canonical bytes owned by the Aiken
 * escrow_script; this function only signs — it never re-encodes them).
 */
export function signReleaseAuthorization(authorizationMessageCborHex: string): string {
  const hex = authorizationMessageCborHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error("authorization message must be non-empty hex-encoded CBOR bytes");
  }
  const { priv } = keys();
  return edSign(null, Buffer.from(hex, "hex"), priv).toString("hex");
}

export function attestationFingerprint(att: OracleAttestation): string {
  return createHash("sha256").update(canonicalize(att as unknown as Record<string, unknown>)).digest("hex");
}
