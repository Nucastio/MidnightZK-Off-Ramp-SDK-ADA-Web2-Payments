import { createHash, randomBytes } from "node:crypto";

const DOMAIN_PAYEE = "offramp:payee:v1";
const DOMAIN_AMOUNT = "offramp:amount:v1";
const DOMAIN_INTENT = "offramp:intent:v1";
const DOMAIN_ADAPTER = "offramp:adapter:v1";
const DOMAIN_QUOTE = "offramp:quote:v1";
const DOMAIN_SETTLEMENT = "offramp:settlement:v1";
const DOMAIN_VK = "offramp:vk:v1";

const VK_HASH = sha256Hex(Buffer.from(`${DOMAIN_VK}|offramp.compact|v0.1.0`, "utf8"));
const CIRCUIT_ID = "offramp:v1";

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function pad32(input: string): Buffer {
  const b = Buffer.alloc(32);
  Buffer.from(input, "utf8").copy(b, 0, 0, Math.min(32, Buffer.byteLength(input)));
  return b;
}

function hashConcat(parts: (string | Buffer)[]): string {
  return sha256Hex(
    Buffer.concat(
      parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p)),
    ),
  );
}

export function randomNonce(byteLen = 16): string {
  return randomBytes(byteLen).toString("hex");
}

export function adapterTag(adapter: string): string {
  return hashConcat([DOMAIN_ADAPTER, "|", adapter]);
}

export function payeeCommitment(handle: string, salt: string): {
  commitment: string;
  secret: string; // 32-byte hex digest fed to the Compact witness
} {
  const secret = sha256Hex(Buffer.from(`${DOMAIN_PAYEE}|${handle}|${salt}`, "utf8"));
  const commitment = sha256Hex(Buffer.concat([pad32(DOMAIN_PAYEE), Buffer.from(secret, "hex")]));
  return { commitment, secret };
}

export function amountCommitment(input: {
  fiatAmount: string;
  fiatCurrency: string;
  railQuoteDigest: string;
  principalLovelace: bigint;
  salt: string;
}): { commitment: string; secret: string } {
  const inner = sha256Hex(
    Buffer.from(
      `${DOMAIN_AMOUNT}|${input.fiatAmount}|${input.fiatCurrency}|${input.railQuoteDigest}|${input.principalLovelace.toString()}|${input.salt}`,
      "utf8",
    ),
  );
  const commitment = sha256Hex(Buffer.concat([pad32(DOMAIN_AMOUNT), Buffer.from(inner, "hex")]));
  return { commitment, secret: inner };
}

export function railQuoteDigest(input: {
  adapter: string;
  fiatAmount: string;
  fiatCurrency: string;
  rate: number;
  fees: string;
  quotedAt: number;
}): string {
  return hashConcat([
    DOMAIN_QUOTE,
    "|",
    input.adapter,
    "|",
    input.fiatAmount,
    "|",
    input.fiatCurrency,
    "|",
    String(input.rate),
    "|",
    input.fees,
    "|",
    String(input.quotedAt),
  ]);
}

export function intentId(input: {
  adapter: string;
  senderPkh: string;
  payeeCommitment: string;
  amountCommitment: string;
  createdAt: number;
}): string {
  return hashConcat([
    DOMAIN_INTENT,
    "|",
    input.adapter,
    "|",
    input.senderPkh,
    "|",
    input.payeeCommitment,
    "|",
    input.amountCommitment,
    "|",
    String(input.createdAt),
  ]);
}

export function settlementDigest(input: {
  intentId: string;
  railTxRef: string;
  status: "SETTLED" | "FAILED";
  signedAt: number;
}): string {
  return hashConcat([
    DOMAIN_SETTLEMENT,
    "|",
    input.intentId,
    "|",
    input.railTxRef,
    "|",
    input.status,
    "|",
    String(input.signedAt),
  ]);
}

export function vkHash(): string {
  return VK_HASH;
}

export function circuitId(): string {
  return CIRCUIT_ID;
}

/** Verify a commitment matches the inputs (used by `verifyZKProof` deterministic checker). */
export function verifyPayeeCommitment(handle: string, salt: string, expected: string): boolean {
  return payeeCommitment(handle, salt).commitment === expected;
}

export function verifyAmountCommitment(
  input: Parameters<typeof amountCommitment>[0],
  expected: string,
): boolean {
  return amountCommitment(input).commitment === expected;
}
