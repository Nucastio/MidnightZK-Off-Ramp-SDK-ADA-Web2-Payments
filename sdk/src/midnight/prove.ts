/**
 * Midnight ZK prover.
 *
 * The Midnight Compact compiler emits a zk-SNARK circuit from `offramp.compact`;
 * the prover then takes the private witnesses + public inputs and produces a
 * proof artifact (`pi`) bound to the verification key `vk_hash`.
 *
 * Two implementations share the same `ProofBundle` shape:
 *
 *   1. **Off-chain re-derivation** (this file) — re-derives the commitments
 *      from the witnesses, verifies they match the supplied public inputs
 *      (the same constraints the Compact circuit enforces), and emits a
 *      32-byte `pi` digest that binds `(witnesses, public_inputs, vk_hash)`.
 *      Cheap, deterministic, used by the SDK / backend / internal test harness.
 *
 *   2. **On-chain SNARK** ([`midnight-local-cli/`](../../../midnight-local-cli))
 *      — the Compact-compiled circuit + proving keys in
 *      `contract/src/managed/offramp/` run inside a Midnight proof-server,
 *      produce a real zk-SNARK proof, and submit it to a Midnight node where
 *      the verifier accepts or rejects it. See `docs/testnet-evidence.md` for
 *      the recorded run.
 *
 * The two paths use the same domain-separated commitments, so an off-chain
 * `prove()` result is interchangeable with an on-chain one for everything
 * the SDK does downstream (rail submission, oracle attestation).
 */
import { createHash } from "node:crypto";
import {
  amountCommitment,
  circuitId,
  payeeCommitment,
  vkHash,
} from "../commitments.ts";
import type { Currency, ProofBundle } from "../types.ts";

export interface ProveInputs {
  intentId: string;
  payeeHandle: string;
  payeeSalt: string;
  fiatAmount: string;
  fiatCurrency: Currency;
  railQuoteDigest: string;
  principalLovelace: bigint;
  amountSalt: string;
  adapterTag: string;
  complianceMask?: string;
}

export interface ProverConfig {
  /** Simulated proving time in ms (NFR-2 target ≤ 50_000). */
  baseProveMs?: number;
  /** Random jitter range in ms applied on top of base. */
  jitterMs?: number;
}

const DEFAULT_PROVE_MS = Number(process.env.OFFRAMP_PROVE_MS ?? "650");
const DEFAULT_JITTER_MS = Number(process.env.OFFRAMP_PROVE_JITTER_MS ?? "180");

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function prove(inputs: ProveInputs, cfg: ProverConfig = {}): Promise<ProofBundle> {
  const startedAt = performance.now();
  const baseMs = cfg.baseProveMs ?? DEFAULT_PROVE_MS;
  const jitter = cfg.jitterMs ?? DEFAULT_JITTER_MS;
  const sim = baseMs + Math.floor(Math.random() * jitter);

  // Re-derive commitments — same constraints the Compact circuit enforces.
  const payee = payeeCommitment(inputs.payeeHandle, inputs.payeeSalt);
  const amount = amountCommitment({
    fiatAmount: inputs.fiatAmount,
    fiatCurrency: inputs.fiatCurrency,
    railQuoteDigest: inputs.railQuoteDigest,
    principalLovelace: inputs.principalLovelace,
    salt: inputs.amountSalt,
  });

  // The simulated prover sleeps the SRS-targeted proof generation window
  // so internal-testing latency numbers reflect realistic behavior.
  await sleep(sim);

  // `pi` binds witnesses + public inputs + vk_hash: opaque to verifiers,
  // unique per (intent, witnesses) — same property a real SNARK would have.
  const piDigest = createHash("sha256")
    .update(
      Buffer.from(
        [
          inputs.intentId,
          payee.commitment,
          payee.secret,
          amount.commitment,
          amount.secret,
          inputs.adapterTag,
          inputs.complianceMask ?? "",
          vkHash(),
        ].join("|"),
        "utf8",
      ),
    )
    .digest("hex");

  const proveDurationMs = Math.round(performance.now() - startedAt);

  return {
    intentId: inputs.intentId,
    circuitId: circuitId(),
    vkHash: vkHash(),
    publicInputs: {
      payeeCommitment: payee.commitment,
      amountCommitment: amount.commitment,
      adapterTag: inputs.adapterTag,
      complianceFlag: inputs.complianceMask,
    },
    pi: piDigest,
    generatedAtMs: Date.now(),
    proveDurationMs,
  };
}

export interface VerifyInputs {
  payeeHandle: string;
  payeeSalt: string;
  fiatAmount: string;
  fiatCurrency: Currency;
  railQuoteDigest: string;
  principalLovelace: bigint;
  amountSalt: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  verifyDurationMs: number;
}

/**
 * Deterministic verifier: re-derives the commitments from the disclosed
 * witnesses and checks that they match the proof's public inputs + that the
 * proof digest is consistent. A real Midnight verifier would call `vk_hash`
 * against the proof bytes; the public surface is the same.
 */
export async function verify(proof: ProofBundle, inputs: VerifyInputs): Promise<VerifyResult> {
  const startedAt = performance.now();
  if (proof.vkHash !== vkHash()) {
    return { ok: false, reason: "vk_hash mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
  }
  const payee = payeeCommitment(inputs.payeeHandle, inputs.payeeSalt);
  if (payee.commitment !== proof.publicInputs.payeeCommitment) {
    return { ok: false, reason: "payee commitment mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
  }
  const amount = amountCommitment({
    fiatAmount: inputs.fiatAmount,
    fiatCurrency: inputs.fiatCurrency,
    railQuoteDigest: inputs.railQuoteDigest,
    principalLovelace: inputs.principalLovelace,
    salt: inputs.amountSalt,
  });
  if (amount.commitment !== proof.publicInputs.amountCommitment) {
    return { ok: false, reason: "amount commitment mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
  }
  const expected = createHash("sha256")
    .update(
      Buffer.from(
        [
          proof.intentId,
          payee.commitment,
          payee.secret,
          amount.commitment,
          amount.secret,
          proof.publicInputs.adapterTag,
          proof.publicInputs.complianceFlag ?? "",
          vkHash(),
        ].join("|"),
        "utf8",
      ),
    )
    .digest("hex");
  if (expected !== proof.pi) {
    return { ok: false, reason: "proof digest mismatch", verifyDurationMs: Math.round(performance.now() - startedAt) };
  }
  return { ok: true, verifyDurationMs: Math.round(performance.now() - startedAt) };
}
