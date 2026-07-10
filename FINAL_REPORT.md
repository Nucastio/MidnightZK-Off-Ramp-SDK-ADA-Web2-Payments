# MidnightZK Off-Ramp SDK — Final Project Report

Final project report summarizing achievements, challenges, lessons learned, and recommended next steps for ecosystem adoption.

- **Project:** MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments (Cash App / Wise / Revolut)
- **Repository:** <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments>
- **Documentation site:** <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/>
- **Release:** [`v1.0.0`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) (MIT)
- **Status:** Public v1.0.0 release; project closed out.

---

## 1. Executive Summary

The MidnightZK Off-Ramp SDK gives Cardano wallets and dApps a **non-custodial path from ADA to fiat**. A user locks ADA in a **Plutus V3 Aiken escrow** on Cardano; a **Midnight zk-SNARK circuit** proves the payee handle and fiat amount match the on-chain commitments without revealing them; a **modular rail adapter** (Cash App / Wise / Revolut) executes the fiat leg; and an **Ed25519 Settlement Oracle** binds the provider's webhook to the escrow's `intent_id`, unlocking the operator-signed `RELEASE` (or the sender-signed `REFUND` after the deadline).

The project ran from initiation (Project Initiation Document, SRS) through architecture (TAD v1 → v1.1), a working prototype, and a stabilized public v1.0.0 release with hosted documentation, a recorded demo, real Cardano Preprod transactions, a live Wise sandbox integration, and a public marketing launch across X and Discord.

## 2. Achievements

| Achievement | Evidence |
|---|---|
| **Full off-ramp pipeline shipped** — Initiate → Lock → Prove → Submit → Settle → Release (+ Refund) | [`sdk/src/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src), [architecture](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/architecture/) |
| **Cardano Plutus V3 escrow validated on Preprod** — 5 real transactions exercising LOCK / REFUND / RELEASE across Cash App + Wise paths | [docs/testnet-evidence.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/testnet-evidence.md) |
| **Midnight Compact circuit deployed** — 4 SNARK proofs (`provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`) across blocks 15774→15784 | [contract/src/offramp.compact](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/contract/src/offramp.compact), testnet-evidence |
| **Live Wise sandbox integration** — real quote / recipient / transfer HTTP calls returning real numeric Wise transfer IDs | [docs/sandbox-evidence/](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/sandbox-evidence) |
| **Final testing green** — 30 simulated off-ramps, 96.7% success (≥90% threshold), avg prove 744.6 ms (≤50 s NFR-2 budget) | [Final Testing & Release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md) |
| **Comprehensive developer docs hosted publicly** — integration guide, API reference, SDK reference, runnable examples, architecture | [Docs site](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/) |
| **v1.0.0 tagged + released** with source archive attached by CI | [Releases](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) |
| **Recorded demo walkthrough** — 2 min 24 s, English narration + subtitles, driven against the real Wise sandbox | [docs/media/offramp-demo.mp4](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4) |
| **Public launch campaign** — 5 posts (4 on X + 1 Discord announcement), engagement tracked | [docs/community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md) |

## 3. Challenges & How They Were Overcome

1. **CIP-30-era tooling vs. ESM packaging.** Lucid Evolution pulls `libsodium-wrappers-sumo`, whose npm publish layout breaks Node ESM resolution (the build expects `libsodium-sumo.mjs` beside `libsodium-wrappers.mjs`). *Fix:* a one-time post-install shell fixup ([`scripts/fix-libsodium.sh`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/fix-libsodium.sh)) documented in the quickstart.
2. **Wise sandbox SCA gating.** The `/v3/profiles/{id}/transfers/{tid}/payments` funding call is SCA-gated on personal-API-token profiles (HTTP 403). *Resolution:* documented as expected provider-side behaviour — the transfer is real and recorded by Wise (`incoming_payment_waiting` state); the SDK's responsibility ends at submitting the funding intent. Captured verbatim in [sandbox-evidence](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/sandbox-evidence/README.md).
3. **Midnight wallet SDK gaps.** The `wallet-sdk-shielded` package needed a patch to run the deploy/run-all flows headlessly. *Fix:* `patch-package` wired into `midnight-local-cli`'s post-install so every clean checkout self-heals.
4. **Deterministic tests vs. live providers.** CI must be hermetic, but the milestone demands real provider evidence. *Fix:* the `RailAdapter` interface got two modes — `mock` (deterministic, used by the 30-run harness, with intentional ~4–6% failure injection to exercise the rejection path) and `sandbox` (live provider HTTP, used for the recorded demo + captured evidence).
5. **Ephemeral demo hosting.** The live MVP is fronted by TryCloudflare quick-tunnels which die with the local process. *Mitigation:* URLs are explicitly labelled *evaluation-window only* in the README, and the quickstart makes local reproduction a 4-command job.

## 4. Lessons Learned

- **Bind commitments to real provider artefacts.** Deriving `railQuoteDigest` from the actual Wise quote ID (not a synthetic value) meant the ZK amount-commitment is provably tied to a real provider rate — a small design choice that made the sandbox evidence much stronger.
- **Ship both adapter modes from day one.** Mock-first made CI reliable; sandbox-behind-a-flag made real-provider evidence a config change rather than a rewrite.
- **Keep the oracle's trust surface tiny.** One Ed25519 keypair, canonical JSON, verify-before-sign, publish only the public key. Auditors can review the whole trust boundary in one file.
- **Evidence should be committed, not linked.** Raw provider responses, per-run JSON, and tx-hash tables live in-repo, so milestone reviewers verify from `main` without trusting external dashboards.
- **Prototype honesty pays.** Marking the Cardano-path proofs as SHA-256 stubs (full ZK proofs are the Midnight path) and SCA-gated funding as provider-side kept the review conversation about what *is* proven, not what's implied.

## 5. Next Steps for Ecosystem Adoption

1. **Full ZK proofs on the Cardano path** — replace the stub digests with on-chain verification of the Midnight proof + oracle attestation in the escrow validator (the datum already carries `vk_hash` for this).
2. **Production rail credentials** — swap sandbox endpoints for production Wise/Revolut APIs behind the same `RailAdapter` interface; add SEPA/ABA/IBAN recipient types.
3. **Wallet integrations** — embed the SDK in a CIP-30 wallet flow so lock-signing happens in the user's own wallet UI.
4. **Security audit + mainnet** — external audit of the escrow validator and oracle before any mainnet deployment.
5. **Community contributions** — the MIT license, hosted docs, and runnable examples lower the bar; the launch campaign ([community-engagement](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md)) is the first call for external developers to build on the rails.

## 6. Reference Documents

- [Project Initiation Document](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1 (canonical)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf)
- [Final Testing & Release document](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md) ([PDF](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.pdf))
- [CHANGELOG](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md)
- [Project Completion Report (PCR)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/PCR.pdf)
