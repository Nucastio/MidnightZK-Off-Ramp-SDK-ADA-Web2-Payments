# Project Completion Report

## MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments

| Field | Value |
|---|---|
| **Project Name** | MidnightZK Off-Ramp SDK: ADA ⇆ Web2 Payments (Cash App, Wise) |
| **Project Number** | 1400082 |
| **Challenge** | F14: Cardano Open: Developers |
| **Project Manager** | Sri Charan |
| **Project Start Date** | November 24, 2025 |
| **Project Completion Date** | June 20, 2026 |
| **Repository** | [Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments) |
| **Documentation site** | [nucastio.github.io/MidnightZK-Off-Ramp-SDK-…](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/) |
| **Project Completion Video (PCV)** | _[public video link — see final PoA submission]_ |

## 1. Deliverables

The project delivered a **non-custodial ADA → fiat off-ramp SDK** for Cardano wallets and dApps: a **Plutus V3 Aiken escrow** locks user ADA under a structured inline `EscrowDatum` (operator-signed `RELEASE`, sender-signed `REFUND` after deadline); **Midnight zk-SNARK circuits** (Compact) prove payee + amount + optional compliance predicates without revealing handles, fiat amounts, or KYC attributes; **modular rail adapters** for **Cash App (Afterpay), Wise, and Revolut** execute the fiat leg (sandbox-first, `mock`/`sandbox` modes behind one `RailAdapter` interface); and an **Ed25519 Settlement Oracle** binds rail webhooks to the escrow's `intent_id`.

| Output | Link |
|---|---|
| Documentation site (single URL) | <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> |
| Source repository | [GitHub](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments) |
| Release (tagged, source archive attached) | [v1.0.0](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) |
| Final Project Report | [FINAL_REPORT.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/FINAL_REPORT.md) |
| Final Testing & Release document | [markdown](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md) · [PDF](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.pdf) |
| Demo walkthrough (English narration + subtitles) | [docs/media/offramp-demo.mp4](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4) |
| Community campaign + engagement record | [docs/community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md) |
| Specification PDFs | [Project Initiation](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf) |

**On-chain evidence (Cardano Preprod + Midnight):** escrow validator at `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`; five real Preprod transactions exercising the full validator surface — [LOCK #1 (Cash App)](https://preprod.cardanoscan.io/transaction/f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3) → [REFUND](https://preprod.cardanoscan.io/transaction/a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9), [LOCK #2 (Wise)](https://preprod.cardanoscan.io/transaction/03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869), [LOCK #3 (Wise)](https://preprod.cardanoscan.io/transaction/b55e48084290f6b88b8fd6489f40e65acc50664fba4873feb1248dffbcb64ac2) → [RELEASE](https://preprod.cardanoscan.io/transaction/c84c242d6f86dbdac54ded62c92bbdc88b5725722d1691728854e20d62bd3168); Midnight contract `a3a72a55eb37317300a6c0718578a8e82040dacce3f139e23e1f52af99f77030` (deploy tx `bb81cf19…6e9f2`, block 15768) with **4 SNARK proofs** across blocks 15774→15784 ([testnet-evidence.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/testnet-evidence.md)).

**Open source:** Yes — **MIT** ([LICENSE](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE), Nucast Labs). **Testing:** 30 simulated off-ramps in the pre-release harness — **96.7% success** (≥ 90% acceptance threshold) with the single failure being the intentional negative-path injection; **avg proof generation 744.6 ms** vs the ≤ 50,000 ms NFR-2 budget; live **Wise sandbox** run committed as raw provider JSON (real transfer `2147582543`); full consolidation in the [Final Testing & Release document](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md). **User feedback:** open community testing campaign launched across X + Discord with issues intake on GitHub ([community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md)). **Visual evidence:** [demo walkthrough video](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4) (2 m 24 s, narration + subtitles, real Wise sandbox on camera).

## 2. Usage

**Who uses it:** Cardano wallet and dApp developers integrating ADA → fiat off-ramps without taking custody; researchers reproducing the ZK-payee-privacy design. **How:** install from the [v1.0.0 release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0), follow the [quickstart](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/quickstart/), drive the 6-step pipeline via the typed `OffRampSDK` class or the bundled Hono REST API (Swagger at `/docs`), with a vanilla web UI for demos. **Key actions completed:** 5 Preprod escrow transactions; 4 Midnight SNARK proofs; a real Wise sandbox transfer; 30-run internal test suite; recorded walkthrough; a 5-post launch campaign reaching the Cardano developer community (Discord announcement alone drew **56 reactions**; campaign total ≥ 100 engagements — [tally](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md)). **Engagement evidence:** X post URLs + analytics screenshots and the Discord announcement screenshot are filed with the PoA.

## 3. Impact

Before this project there was **no open-source, non-custodial ADA → fiat off-ramp with ZK payee privacy** — users either handed custody to centralized exchanges or leaked payee handles and amounts on-chain. After v1.0.0: an MIT-licensed SDK exists in which **funds never leave script control** (lock/release/refund all enforced by the Plutus V3 validator), **payee + amount stay private** (Midnight zk-SNARK commitments; the escrow datum carries only hashes), and the **fiat leg is pluggable** across three major consumer rails. Performance is measured, not asserted: sub-second proving (744.6 ms avg vs a 50 s budget) and 96.7% pipeline success across the release harness. **Cardano ecosystem benefit:** a reusable escrow-validator pattern (Aiken, blueprint committed), the first Midnight-circuit + Cardano-escrow composition in the off-ramp space, and committed raw evidence (Cardanoscan-verifiable txs, provider JSON) that other teams can use as an integration reference. The launch campaign put the SDK in front of the Cardano developer community with tracked engagement, opening the community-testing funnel.

## 4. Sustainability

**Ongoing.** The repository remains the canonical, MIT-licensed home. **Maintenance model:** GitHub issues/PRs; SemVer with a maintained [CHANGELOG](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md); CI (`docs.yml` auto-deploys the docs site on every docs change; `release.yml` cuts a GitHub Release on every `v*` tag). **Revenue model:** the SDK is free; Nucast pursues production-rail integrations and wallet partnerships on top of it, with follow-on Catalyst funding for the mainnet-hardening roadmap. **Roadmap:** full ZK verification on the Cardano path (datum already carries `vk_hash`), production Wise/Revolut credentials + SEPA/ABA recipient types, CIP-30 wallet embedding, external security audit before mainnet — detailed in [FINAL_REPORT.md §5](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/FINAL_REPORT.md). **Permanent storage + forking:** public GitHub (fork-friendly), tagged releases with source archives, docs site rebuildable from the repo (`mkdocs build`); required env values documented in `.env.example`; no proprietary services needed to build or test.

---

**Project Completion Video (PCV):** _public video link included in the final PoA submission._ Supplementary in-repo recording: [docs/media/offramp-demo.mp4](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4) — live technical walkthrough with English audio commentary and subtitles, executing a real Wise-sandbox off-ramp end-to-end.
