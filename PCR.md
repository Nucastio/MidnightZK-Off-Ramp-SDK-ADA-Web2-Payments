# Project Completion Report

## MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments

> **Revision note (v2.0.0):** this report originally described the v1.0.0 submission. The claims below match the current v2.0.0 implementation on `main`; superseded v1.0.0 metrics are retained but explicitly labeled. The honest trust model is in [docs/trust-model.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md).

| Field | Value |
|---|---|
| **Project Name** | MidnightZK Off-Ramp SDK: ADA ⇆ Web2 Payments (Cash App, Wise) |
| **Project Number** | 1400082 |
| **Challenge** | F14: Cardano Open: Developers |
| **Project Manager** | Sri Charan |
| **Project Start Date** | November 24, 2025 |
| **Project Completion Date** | June 20, 2026 (v1.0.0) — v2.0.0 implementation July 2026 |
| **Repository** | [Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments) |
| **Documentation site** | [nucastio.github.io/MidnightZK-Off-Ramp-SDK-…](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/) |
| **Project Completion Video (PCV)** | [youtu.be/FDI2ymlPqXY](https://youtu.be/FDI2ymlPqXY) (shows the v1 flow) |

## 1. Deliverables

The project delivers a **non-custodial ADA → fiat off-ramp SDK** for Cardano wallets and dApps:

- A **Plutus V3 Aiken escrow** locks user ADA under a structured inline `EscrowDatum`. **Release** requires an **oracle-signed, UTxO-bound release authorization verified on-chain** (Ed25519 over the datum + exact spending output reference + settlement digest + Midnight settlement-receipt hash + expiry), the operator's signature, a validity window before both the deadline and the authorization expiry, and full escrow value to the datum-bound operator address. **Refund** is deadline-gated, sender-signed, and value-preserving. **25/25 Aiken tests; 17/17 Lucid-emulator on-chain tests.**
- **Midnight zk-SNARK circuits** (Compact) execute through a **required `MidnightProofProvider`** — the SDK fails closed with no simulation fallback. Receipts carry finalized Midnight tx/block/state evidence pinned by the deterministic 23-asset circuit **artifact manifest hash** (`vkHash`, on-chain `circuit_artifact_hash`).
- **Modular rail adapters**: **Revolut** (live sandbox **verified** — real payment completed through the adapter), **Wise** (strict sandbox client — quote-bound transfers, deterministic idempotency, no mock fallback; fresh evidence pending a new sandbox token), **Cash App** (implemented against the official Payouts API; **credential-gated early-access** — not live-evidenced). Deterministic mocks are test-only via `RAIL_ADAPTER_MODE=mock`.
- An **Ed25519 Settlement Oracle** that attests only **adapter-observed** provider settlement and signs the on-chain release authorization. **Trust model:** Cardano does **not** verify SNARKs directly — release is oracle-attested; see [docs/trust-model.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md).
- A **backend** with lifecycle state machine, per-intent capability-token auth, adapter-observed settlement, and PII redaction (**15/15 tests**), plus a demo UI (API 8788 / UI 5174).

| Output | Link |
|---|---|
| Documentation site (single URL) | <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> |
| Source repository | [GitHub](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments) |
| Trust model | [docs/trust-model.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/trust-model.md) |
| E2E evidence (v2.0.0) | [docs/evidence/v2.0.0/](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0) |
| Release v1.0.0 (superseded, historical) | [v1.0.0](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) |
| Final Project Report | [FINAL_REPORT.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/FINAL_REPORT.md) |
| Final Testing & Release document (v1.0.0, historical) | [markdown](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md) · [PDF](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.pdf) |
| Demo walkthrough (v1 flow) | [docs/media/offramp-demo.mp4](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4) |
| Community campaign + engagement record | [docs/community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md) |
| Specification PDFs | [Project Initiation](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf) |

**Testing (v2.0.0, real counts):** Aiken validator **25/25** · Lucid emulator on-chain suite **17/17** · backend API + oracle **15/15** · typecheck green across all workspaces (enforced in CI) · full-pipeline E2E drivers with machine-readable evidence in `docs/evidence/v2.0.0/`.

**Superseded v1.0.0 metrics (historical, labeled):** the previously reported "30 simulated off-ramps, 96.7% success" table was produced by the **mock-adapter simulation harness**, and the "744.6 ms avg proof generation" figure measured a **SHA-256 digest simulation, not SNARK proving** — neither is evidence of live rails or real proving latency. The five v1 Preprod transactions ran against the old **signature-only** validator (the early refund succeeding demonstrates the missing deadline enforcement); the local Midnight run was **placeholder-anchored**; the v1 Wise sandbox transfer `2147582543` was **never funded** (SCA-gated, `incoming_payment_waiting`). Details: [docs/final-testing-and-release.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/final-testing-and-release.md), [docs/testnet-evidence.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/testnet-evidence.md).

**Open source:** Yes — **MIT** ([LICENSE](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE), Nucast Labs). **User feedback:** open community testing campaign across X + Discord with issues intake on GitHub ([community-engagement.md](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/community-engagement.md)).

## 2. Usage

**Who uses it:** Cardano wallet and dApp developers integrating ADA → fiat off-ramps without taking custody; researchers reproducing the ZK-payee-privacy design. **How:** clone the repo, follow the [quickstart](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/quickstart/), drive the pipeline via the typed `OffRampSDK` class (which requires a real `MidnightProofProvider`) or the bundled Hono REST API (Swagger at `/docs`, capability-token auth), with a vanilla web UI for demos. **Key actions completed (v2.0.0):** v2.0.0 validator with 25 on-chain-semantics unit tests + 17 emulator tests; real Midnight receipts anchored to Cardano locks; a **real Revolut sandbox payment through the SDK adapter**; hardened backend (15 tests); E2E evidence drivers writing `docs/evidence/v2.0.0/`. Historical v1 actions (5 Preprod txs on the old validator, placeholder-anchored Midnight run, unfunded Wise transfer, 30-run simulation harness, demo video, launch campaign with ≥ 100 engagements) are retained with labels in the docs.

## 3. Impact

Before this project there was **no open-source, non-custodial ADA → fiat off-ramp with ZK payee privacy** — users either handed custody to centralized exchanges or leaked payee handles and amounts on-chain. As of v2.0.0: an MIT-licensed SDK exists in which **funds can only move to datum-pinned destinations** (release requires an on-chain-verified, oracle-signed, single-use authorization; refund is deadline-gated and sender-recoverable without anyone's cooperation), **payee + amount stay private** (Midnight SNARK commitments; the escrow datum carries only hashes), and the **fiat leg is pluggable** across three consumer rails with honestly labeled evidence (Revolut verified; Wise pending token; Cash App credential-gated). The trust model is stated plainly — **Cardano does not verify SNARKs directly; release is oracle-attested** — which makes the design auditable rather than oversold. **Cardano ecosystem benefit:** a reusable oracle-authorized escrow pattern (Aiken, blueprint + 25 tests committed), a Midnight-circuit + Cardano-escrow composition with finalized-receipt plumbing, and committed machine-readable evidence other teams can use as an integration reference.

## 4. Sustainability

**Ongoing.** The repository remains the canonical, MIT-licensed home. **Maintenance model:** GitHub issues/PRs; SemVer with a maintained [CHANGELOG](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md); CI runs typecheck + builds + the full test suites on every push (`ci.yml`), docs auto-deploy (`docs.yml`), tagged releases (`release.yml`). **Revenue model:** the SDK is free; Nucast pursues production-rail integrations and wallet partnerships on top of it. **Roadmap:** complete the pending Wise-token evidence run; obtain Cash App partner credentials; public Midnight testnet deployment of the circuit set; CIP-30 wallet embedding; HSM/KMS key management for the oracle; external security audit before any mainnet use — detailed in [FINAL_REPORT.md §5](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/FINAL_REPORT.md). **Permanent storage + forking:** public GitHub, tagged releases, docs rebuildable via `mkdocs build`; required env values documented in `.env.example`; no proprietary services needed to build or test (Blockfrost/provider sandboxes are free-tier).

---

**Project Completion Video (PCV):** [youtu.be/FDI2ymlPqXY](https://youtu.be/FDI2ymlPqXY) — public YouTube link, English audio commentary. *Note: the video captures the v1.0.0 flow (including the since-replaced simulation prove path and the unfunded Wise sandbox run); it predates the v2.0.0 implementation.* Supplementary in-repo recording: [docs/media/offramp-demo.mp4](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/media/offramp-demo.mp4).
