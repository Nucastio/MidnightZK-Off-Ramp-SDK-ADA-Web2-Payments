/**
 * Settlement Oracle (TAD §7.5).
 *
 * Ingests rail-adapter webhook payloads, verifies the adapter HMAC, then emits
 * a canonical signed attestation bound to `intent_id`. Signature is Ed25519
 * over the deterministic JSON canonicalization of the attestation body using
 * the operator key from `OPERATOR_ED25519_SK_HEX`.
 *
 * The current build runs an in-process oracle that produces deterministic
 * attestations. A future revision will split this into a distinct service
 * binary with key rotation + persistence.
 */
import { createHash, createHmac, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey, KeyObject } from "node:crypto";
import { settlementDigest } from "../commitments.ts";
import type { OracleAttestation } from "../types.ts";

const ADAPTER_HMAC_KEY = process.env.RAIL_WEBHOOK_HMAC_KEY ?? "offramp-dev-shared-hmac-key";

function sk32(): Buffer {
  const hex = process.env.OPERATOR_ED25519_SK_HEX ?? "";
  if (hex.length !== 64) {
    throw new Error("OPERATOR_ED25519_SK_HEX must be 32-byte hex (64 chars)");
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

export function verifyAdapterWebhook(payload: Record<string, unknown>, providedHmac: string): boolean {
  const expected = createHmac("sha256", ADAPTER_HMAC_KEY)
    .update(JSON.stringify(payload))
    .digest("hex");
  return expected === providedHmac;
}

function canonicalize(obj: Record<string, unknown>): string {
  // Stable JSON: sorted keys, no whitespace.
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + JSON.stringify(obj[k])).join(",") + "}";
}

export function attestSettlement(input: {
  intentId: string;
  railTxRef: string;
  status: "SETTLED" | "FAILED";
}): OracleAttestation {
  const signedAt = Math.floor(Date.now() / 1000);
  const digest = settlementDigest({ ...input, signedAt });
  const body = {
    intent_id: input.intentId,
    rail_tx_ref: input.railTxRef,
    status: input.status,
    settlement_digest: digest,
    signed_at: signedAt,
  };
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
  const body = {
    intent_id: att.intentId,
    rail_tx_ref: att.railTxRef,
    status: att.status,
    settlement_digest: att.settlementDigest,
    signed_at: att.signedAt,
  };
  const { pub } = keys();
  return edVerify(null, Buffer.from(canonicalize(body), "utf8"), pub, Buffer.from(att.signature, "hex"));
}

export function attestationFingerprint(att: OracleAttestation): string {
  return createHash("sha256").update(canonicalize(att as unknown as Record<string, unknown>)).digest("hex");
}
