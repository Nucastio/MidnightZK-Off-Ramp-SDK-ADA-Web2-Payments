# MidnightZK Off-Ramp SDK — Final Project Report

Final project report summarizing achievements, challenges, lessons learned, and recommended next steps for ecosystem adoption.

- **Project:** MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments (Cash App / Wise / Revolut)
- **Repository:** <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments>
- **Documentation site:** <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/>
- **Release:** [`v1.0.0`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) (MIT) — **superseded** by the v2.0.0 implementation on `main`
- **Status:** v2.0.0 is the current implementation. This report's achievements/limitations sections reflect the v2.0.0 claims; superseded v1.0.0 metrics are retained with labels.

---

## 1. Executive Summary

The MidnightZK Off-Ramp SDK gives Cardano wallets and dApps a **non-custodial path from ADA to fiat**. A user locks ADA in a **Plutus V3 Aiken escrow** on Cardano; **Midnight zk-SNARK circuits** (executed through a required real proof provider) prove the payee handle and fiat amount match the on-chain commitments without revealing them; a **modular rail adapter** (Wise / Revolut / Cash App) executes the fiat leg; and an **Ed25519 Settlement Oracle** — after observing the provider's authenticated settlement status through the adapter — signs a **UTxO-bound release authorization that the escrow validator verifies on-chain**, unlocking the operator's `RELEASE` (or the sender's deadline-gated `REFUND`).

**Trust model, stated plainly:** Cardano does **not** verify Midnight SNARKs directly. The validator verifies the oracle's Ed25519 signature over a message binding the Midnight settlement-receipt hash to the exact escrow UTxO; the oracle/operator is a trusted role, and the sender's post-deadline refund needs no one's cooperation. Full statement: [docs/trust-model.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md).

The project ran from initiation (PID, SRS) through architecture (TAD v1 → v1.1), the v1.0.0 public release, and the v2.0.0 hardening of the on-chain, Midnight, adapter, and backend layers.

## 2. Achievements (v2.0.0)

| Achievement | Evidence |
|---|---|
| **Escrow validator with real enforcement** — oracle-signed UTxO-bound release authorization (single-use; verified on-chain), deadline-gated refund, exact datum-bound destinations, full value preservation | [`cardano/escrow/validators/escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak) — **25/25** Aiken tests |
| **On-chain E2E test coverage** — full positive/negative matrix (tampered digests/signatures, replay across UTxOs, wrong signers, premature refund, partial value) against the real blueprint on a Lucid emulator | [`sdk/test/escrow-emulator.test.mjs`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/test/escrow-emulator.test.mjs) — **17/17** |
| **Real Midnight integration, fail-closed** — no SHA simulation path; required `MidnightProofProvider`; receipts carry finalized Midnight tx/block/state data anchored to the Cardano lock, pinned by the 23-asset artifact manifest hash | [`sdk/src/midnight/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/midnight), [`midnight-local-cli/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/midnight-local-cli) |
| **Revolut live sandbox VERIFIED** — a real sandbox payment completed through the SDK adapter (refresh-token grant; JWT `iss` = certificate redirect-URI domain) | [`sdk/src/adapters/revolut.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/adapters/revolut.ts) + `docs/evidence/v2.0.0/` |
| **Wise strict sandbox client** — provider quote-bound transfers, deterministic idempotency, authenticated status, webhook verification, no mock fallback | [`sdk/src/adapters/wise.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/adapters/wise.ts) (live run pending a fresh token) |
| **Cash App adapter against the official Payouts API** — code-complete, honestly labeled credential-gated (early-access partner product) | [`sdk/src/adapters/cashapp.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/adapters/cashapp.ts) |
| **Hardened backend** — lifecycle state machine, per-intent capability tokens, adapter-observed settlement (caller statuses rejected), PII redaction, datum-bound release/refund | [`backend/api/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/backend/api) — **15/15** tests |
| **Typecheck green across all workspaces, enforced in CI** | [`.github/workflows/ci.yml`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/.github/workflows/ci.yml) |
| **E2E evidence drivers** — full pipeline + refund path with machine-readable capture | [`scripts/e2e-preprod.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/e2e-preprod.ts) → `docs/evidence/v2.0.0/` |
| **Honest documentation** — trust model page; all v1 evidence retained with historical/superseded labels | [docs site](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/), [Trust model](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md) |
| **Public launch campaign** — 5 posts (4 X + 1 Discord), engagement tracked | [docs/community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md) |

**Superseded v1.0.0 metrics (historical — do not cite as current):** "30 simulated off-ramps, 96.7% success" was the **mock-adapter simulation harness**; "avg prove 744.6 ms" measured the **SHA-256 digest simulation, not SNARK proving**; the five v1 Preprod txs exercised a signature-only validator (the early refund evidences the missing deadline check); the Midnight run was placeholder-anchored; the Wise transfer was unfunded. Labeled records: [final-testing-and-release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md), [testnet-evidence](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/testnet-evidence.md).

## 3. Challenges & How They Were Overcome

1. **Replacing the v1.0.0 prototype internals.** The original release used a SHA-256 digest path in place of ZK proving, a signature-only validator, and mock-backed "sandbox" claims. v2.0.0 replaced each layer with enforced behavior (fail-closed provider, on-chain-verified oracle authorization, strict sandbox clients) and rewrote the documentation to state the trust model honestly.
2. **Cardano cannot verify Midnight SNARKs on-chain.** Rather than implying otherwise, the design makes the bridge explicit: the oracle signs a domain-separated, single-use authorization binding the settlement-receipt hash to the exact UTxO, and the validator verifies that Ed25519 signature. The residual trust is documented, not hidden.
3. **Provider sandbox friction.** Wise personal-token funding is SCA-gated (the v1 transfer was never funded) and Wise sandbox tokens expire; Cash App's Payouts API is an early-access partner product. The adapters were built strictly against provider semantics with no mock fallback, and evidence claims are scoped to what actually ran (Revolut verified; others pending/gated).
4. **ESM/tooling issues.** `libsodium-wrappers-sumo` breaks Node ESM resolution; fixed by an automatic post-install fixup ([`scripts/fix-libsodium.sh`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/fix-libsodium.sh)). The Midnight wallet SDK needed `patch-package` in `midnight-local-cli`.
5. **Deterministic CI vs. real evidence.** CI stays hermetic with the test-only mock adapters and emulator suites; real evidence comes from the separate E2E drivers that write machine-readable captures to `docs/evidence/v2.0.0/` (including the verbatim failing stage on error).

## 4. Lessons Learned

- **Enforce on-chain what the docs claim.** Every property the v1 docs implied (deadline, settlement binding, destinations, value) now has a validator check and a negative test proving its absence fails.
- **Fail closed at trust boundaries.** The proof provider, the webhook HMAC key, and the oracle key are all hard requirements — no silent dev fallbacks in production paths.
- **Bind authorizations to UTxOs.** Signing over the exact `OutputReference` makes release authorizations single-use and replay-proof for free.
- **Label simulation as simulation.** Harness metrics, mock adapters, and gated integrations are clearly marked; evidence claims are scoped to what actually ran.
- **Evidence should be committed and machine-readable.** JSON stage captures with verbatim errors make re-review cheap.

## 5. Next Steps for Ecosystem Adoption

1. **Complete the pending evidence** — fresh Wise sandbox token run; Cash App partner credentials; keep `docs/evidence/v2.0.0/` as the canonical record.
2. **Public Midnight testnet deployment** — the provider currently targets a local/undeployed network configuration; moving to public Midnight testnet is environment configuration plus funding.
3. **Wallet integrations** — embed the SDK in a CIP-30 wallet flow so lock-signing happens in the user's own wallet UI.
4. **Oracle hardening** — HSM/KMS custody for `OPERATOR_ED25519_SK_HEX`, key-rotation procedure, and eventually multi-oracle or threshold attestation to reduce the single-signer trust.
5. **Security audit + mainnet** — external audit of the escrow validator and oracle before any mainnet deployment.
6. **Community contributions** — MIT license, hosted docs, runnable examples, and the launch campaign ([community-engagement](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md)) as the entry funnel.

## 6. Reference Documents

- [Trust model](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md)
- [Project Initiation Document](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1 (canonical)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf)
- [Final Testing & Release document (v1.0.0, historical)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md) ([PDF](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.pdf))
- [CHANGELOG](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md) · [Project Completion Report (PCR)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/PCR.md)
