# Final Testing & Release Document

!!! warning "Historical v1.0.0 document — superseded by v2.0.0"
    This page consolidated the test artefacts for the **v1.0.0** public release and is retained for the audit trail. It has been superseded by the v2.0.0 implementation. Headline corrections to the claims below:

    - The "proof generation" latencies (744.6 ms avg) were measured on a **SHA-256 digest simulation**, not SNARK execution. v2 removed the simulation: the SDK requires a real `MidnightProofProvider` and fails closed without one.
    - The "29/30 (96.7%)" success table came from the **mock-adapter simulation harness**, not live rails.
    - The five Preprod transactions ran against the **old signature-only validator**; the early REFUND succeeding demonstrates the **missing deadline enforcement**, and the RELEASE verified nothing beyond an operator signature.
    - The Wise sandbox transfer `2147582543` was created but **never funded** (SCA-gated; final state `incoming_payment_waiting`).
    - The Midnight deployment was a **placeholder-anchored local devnet run**, not bound to a real Cardano lock.

    **Current (v2.0.0) verification:** Aiken validator **25/25** (`npm run cardano:check`) · Lucid emulator suite **17/17** (`sdk/test/escrow-emulator.test.mjs`) · backend API + oracle **15/15** (`npm run test:backend`) · `npm run typecheck` passes · E2E evidence in [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0).

| Item | Status |
|---|---|
| Tagged release | **v1.0.0** — [GitHub Release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) (superseded by the remediated v2.0.0 implementation on `main`) |
| Hosted developer docs | <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> |
| Public GitHub repository | <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments> |
| Recorded demo walkthrough | [`docs/media/offramp-demo.mp4`](media/offramp-demo.mp4) |

---

## 1. Internal testing — v1.0.0 simulation harness (historical)

> **Label:** these numbers were produced by the in-process **simulation harness** (`RAIL_ADAPTER_MODE=mock`, SHA-digest "proof" path). They are not live-rail or SNARK measurements. Real test counts for v2.0.0 are in the banner above.

A run of `npm run test:internal` against the v1.0.0 build reported **29 / 30 simulated successes (96.7%)**; the single failure was the mock adapters' intentional ~4–6% rejection injection exercising the `RailError` path.

**Run timestamp:** `2026-06-13T10:35:32.919Z`
**Total simulated off-ramps:** 30 (10 × cashapp / wise / revolut, all mock adapters)
**Simulated success rate:** 96.7%
**Avg simulated "prove" latency:** 744.6 ms — **this measured the SHA-256 simulation, not SNARK proving**, so it does not evidence the NFR-2 (≤ 50 s) budget for real proofs. Real Midnight proving times for v2 are recorded in the E2E evidence (`docs/evidence/v2.0.0/`).

| Rail | Runs | Successes | Failures | Success rate | Avg "prove" (ms, simulated) | Avg submit (ms, mock) |
|------|------|-----------|----------|--------------|----------------------------|-----------------------|
| cashapp | 10 | 10 | 0 | 100.0% | 742.69 | 0.27 |
| wise | 10 | 10 | 0 | 100.0% | 763.34 | 1778.12 |
| revolut | 10 | 9 | 1 | 90.0% | 727.76 | 0.17 |

## 2. Cardano Preprod — v1 validator (historical, superseded)

Five Preprod transactions were submitted against the **v1 signature-only validator** (script `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`). They are listed with corrections in [`testnet-evidence.md`](testnet-evidence.md). Contrary to the original wording, they did **not** exercise a "full validator surface": the v1 validator had no deadline, settlement, destination, or value checks — the early REFUND that was accepted is itself evidence of the missing deadline enforcement.

The v2 validator (oracle-signed UTxO-bound release authorization, deadline-gated refund, exact destinations, full value preservation) is verified by **25/25 Aiken tests** and the **17/17 Lucid emulator suite**, and on Preprod by the E2E runs in `docs/evidence/v2.0.0/`.

## 3. Wise sandbox — v1 evidence (historical; transfer unfunded)

The v1 Wise sandbox run created real provider objects (profile `30539072`, quote `fedc7ae5-…`, recipient `702406717`, transfer `2147582543`) but the transfer was **never funded**: the funding call returned 403 (SCA-gated) and the final observed state was `incoming_payment_waiting`. Raw captures remain under [`docs/sandbox-evidence/`](sandbox-evidence/README.md).

**v2 status of the adapters:**

- **Wise** — rewritten as a strict sandbox client: provider quote-bound transfer creation, deterministic idempotency, authenticated status polling, webhook signature verification, **no mock fallback**. Fresh evidence requires a fresh `WISE_API_TOKEN` (pending).
- **Revolut** — live sandbox **verified**: a real sandbox payment was completed through the adapter (refresh-token OAuth grant; JWT `iss` = certificate redirect-URI domain).
- **Cash App** — implemented against the **official Cash App Payouts API**; this is an early-access partner product and remains **credential-gated** — it must not be represented as live-evidenced.

## 4. Midnight ZK circuit — v1 local run (historical; placeholder-anchored)

The v1 local-devnet deployment (contract `a3a72a55…`, blocks 15768→15784) produced real SNARK proofs on a local node but was **placeholder-anchored** — not bound to any real Cardano lock. See the corrected record in [`testnet-evidence.md`](testnet-evidence.md). In v2, `bindOffRampIntent` anchors the real Cardano lock tx and receipts carry finalized Midnight tx/block/state data pinned by the 23-asset artifact manifest hash.

## 5. Backend API

`npm run dev` boots the Hono server (default port **8788**) serving the lifecycle as REST with a state machine, per-intent capability-token auth, adapter-observed settlement, and PII-redacting persistence — 15/15 tests. OpenAPI at `/docs` (Swagger) and `/api/openapi.json`. All routes documented in the [API reference](api-reference.md). The v1 TryCloudflare "live MVP" tunnels are offline (they were ephemeral evaluation-window tunnels).

## 6. Issues fixed before the v1.0.0 release (historical)

| Issue | Fix | Where |
|---|---|---|
| `libsodium-wrappers-sumo` ESM resolution | One-time shell fixup copying the file into the expected location (now run automatically on `npm install`). | [`scripts/fix-libsodium.sh`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/fix-libsodium.sh) |
| Mock-mode rail rejection wasn't reflected in the harness summary | Per-rail success-rate column + "Failures" section in the regenerated report. | [`scripts/internal-test.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/internal-test.ts) |
| Wise sandbox `/payments` SCA-gating | Documented as provider-side; **correction:** this left the v1 transfer unfunded, so the v1 Wise evidence shows an accepted-but-unfunded transfer, not a settled payout. | [`docs/sandbox-evidence/README.md`](sandbox-evidence/README.md) |

## 7. Acceptance-criteria checklist — corrected

| Milestone criterion | v1.0.0 claim | Corrected status |
|---|---|---|
| Comprehensive developer docs published | ✅ | ✅ — docs since rewritten to match the remediated implementation |
| Final testing + release document | ✅ | This page (historical) + the v2 banner above |
| Public GitHub repository | ✅ | ✅ |
| Recorded demo walkthrough video | ✅ | ✅ (shows the v1 flow) |
| Tagged release | ✅ v1.0.0 | v1.0.0 superseded; remediated implementation on `main` |
| Transaction success rate ≥ 90% | "96.7%" | **Simulation-harness figure** (mock adapters). Real v2 counts: 25/25 Aiken, 17/17 emulator, 15/15 backend; E2E runs in `docs/evidence/v2.0.0/` |
| Proof generation ≤ 50 000 ms (NFR-2) | "744.6 ms avg" | **Simulated** (SHA digest, not SNARK). Real proving latency recorded in v2 E2E evidence |
| Smart contracts deploy and function on Cardano testnet | "5 Preprod txs" | v1 txs exercised a signature-only validator; the enforcing v2 validator is test-covered (25 + 17) with E2E Preprod evidence in `docs/evidence/v2.0.0/` |
| Real sandbox provider integration | "Wise transfer `2147582543`" | v1 Wise transfer was **unfunded**. v2: **Revolut live sandbox verified** (real payment completed); Wise strict client pending a fresh token; Cash App credential-gated |
| Midnight ZK circuit deployed | "4 SNARK proofs" | v1 run was local + placeholder-anchored; v2 receipts carry finalized, lock-anchored Midnight txs |

## 8. Released artefacts

- **`v1.0.0` GitHub Release** (superseded) — <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0>
- **MIT LICENSE** — <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE>
- **CHANGELOG** — <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md>
- **Specifications:** [Project Initiation](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1 (canonical)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf)

## 9. Documentation link

**Hosted developer documentation:** <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> — rebuilt automatically on every change to `docs/` or `mkdocs.yml` via [`.github/workflows/docs.yml`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/.github/workflows/docs.yml). Start with the [trust model](trust-model.md) for an honest statement of what each layer proves.
