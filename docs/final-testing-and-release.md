# Final Testing & Release Document

This document consolidates every test artefact for the **MidnightZK Off-Ramp SDK** at the **`v1.0.0`** public release, plus the links to the released SDK and the hosted documentation site, so a reviewer can verify "the SDK is operational without any major errors" from one page.

| Item | Status |
|---|---|
| Tagged release | **v1.0.0** — [GitHub Release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) |
| Hosted developer docs | <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> |
| Public GitHub repository | <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments> |
| Recorded demo walkthrough | [`docs/media/offramp-demo.mp4`](media/offramp-demo.mp4) |

---

## 1. Internal testing (fresh re-run, 2026-06-13)

A fresh run of the internal harness (`npm run test:internal`) was executed against the v1.0.0 build immediately before tagging the release. Result: **29 / 30 successes (96.7%)**, comfortably above the ≥ 90% acceptance threshold. The single failure is an **intentional negative-path** (the mock-mode adapters inject a ~4–6% adapter-rejection rate to exercise the `RailError` path in `submitPayment`).

**Run timestamp:** `2026-06-13T10:35:32.919Z`
**Total simulated off-ramps:** 30 (10 × cashapp / wise / revolut)
**Overall success rate:** **96.7%** — PASS (threshold ≥ 90%)
**Avg proof-generation latency:** **744.6 ms** — PASS (NFR-2 budget ≤ 50 000 ms)
**Avg proof-verification latency:** 0.21 ms

| Rail | Runs | Successes | Failures | Success rate | Avg prove (ms) | Avg verify (ms) | Avg submit (ms) | Avg attest (ms) |
|------|------|-----------|----------|--------------|----------------|------------------|-----------------|-----------------|
| cashapp | 10 | 10 | 0 | 100.0% | 742.69 | 0.17 | 0.27 | 0.85 |
| wise | 10 | 10 | 0 | 100.0% | 763.34 | 0.19 | 1778.12 | 0.55 |
| revolut | 10 | 9 | 1 | 90.0% | 727.76 | 0.28 | 0.17 | 0.46 |

The full report (per-step latency, methodology, issues-and-fixes) is in [`internal-testing-report.md`](internal-testing-report.md).

> Reproduce: `npm run test:internal` from a clean checkout. Rewrites `docs/internal-testing-report.md` + `data/testing-report.json`.

## 2. Cardano Preprod end-to-end

Five real Preprod transactions exercise the **full validator surface** (LOCK / REFUND / RELEASE for both Cash App and Wise paths). All five are confirmed on-chain and linked from [`testnet-evidence.md`](testnet-evidence.md):

| Step | Adapter | Tx hash | Cardanoscan |
|------|---------|---------|-------------|
| LOCK #1 | Cash App | `f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3` | [view](https://preprod.cardanoscan.io/transaction/f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3) |
| REFUND  | sender-signed | `a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9` | [view](https://preprod.cardanoscan.io/transaction/a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9) |
| LOCK #2 | Wise | `03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869` | [view](https://preprod.cardanoscan.io/transaction/03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869) |
| LOCK #3 | Wise | `b55e48084290f6b88b8fd6489f40e65acc50664fba4873feb1248dffbcb64ac2` | [view](https://preprod.cardanoscan.io/transaction/b55e48084290f6b88b8fd6489f40e65acc50664fba4873feb1248dffbcb64ac2) |
| RELEASE | operator-signed | `c84c242d6f86dbdac54ded62c92bbdc88b5725722d1691728854e20d62bd3168` | [view](https://preprod.cardanoscan.io/transaction/c84c242d6f86dbdac54ded62c92bbdc88b5725722d1691728854e20d62bd3168) |

- **Validator:** [`cardano/escrow/validators/escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak), Plutus V3, Aiken v1.1.21.
- **Script address (Preprod):** `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`
- **Datum shape recorded on-chain:** `intent_id`, `payee_commitment`, `amount_commitment`, `adapter_tag`, `sender_pkh`, `operator_pkh`, `deadline`, `vk_hash`, `principal_lovelace` (each LOCK tx in the table above carries a concrete instance).

## 3. Wise sandbox — live provider integration

The Wise sandbox adapter was driven end-to-end against the public Wise sandbox (`https://api.sandbox.transferwise.tech`) with `RAIL_ADAPTER_MODE=sandbox`. Six raw provider request/response captures are committed under [`docs/sandbox-evidence/`](sandbox-evidence/README.md), demonstrating real off-ramp flows when credentials are configured.

| Step | File | API path | Method | HTTP |
|------|------|----------|--------|------|
| 1. List profiles | `01-profiles.json` | `/v1/profiles` | GET | 200 |
| 2. Create quote (USD → USD, 1.50) | `02-quote.json` | `/v3/profiles/{id}/quotes` | POST | 200 |
| 3. Create recipient | `03-recipient.json` | `/v1/accounts` | POST | 200 |
| 4. Create transfer | `04-transfer.json` | `/v1/transfers` | POST | 200 |
| 5. Fund transfer | `05-fund.json` | `/v3/profiles/{id}/transfers/{tid}/payments` | POST | 403 (SCA-gated; provider-side) |
| 6. Check transfer status | `06-status.json` | `/v1/transfers/{tid}` | GET | 200 |

**Real Wise transfer:** `2147582543`, sandbox profile `30539072`, quote `fedc7ae5-c015-4e37-bb71-404104419610`, recipient `702406717`. Status `incoming_payment_waiting` (the documented Wise state for an unfunded transfer; funding completion requires either an OAuth-token profile or Wise SCA approval and is provider-side).

> Cash App uses **Afterpay sandbox** semantics — canonical provider reference: <https://www.postman.com/afterpay-1-426879/afterpay-online-apis-v2/folder/zohg5nd/checkouts>. Revolut follows the same `RailAdapter` interface and is ready for credentials.

## 4. Midnight ZK circuit deployment

- **Compact source:** [`contract/src/offramp.compact`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/contract/src/offramp.compact)
- **Compiled artefacts (committed):** [`contract/src/managed/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/contract/src/managed)
- **Predicates:** `provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`
- **Contract address:** `a3a72a55eb37317300a6c0718578a8e82040dacce3f139e23e1f52af99f77030`
- **Deploy tx:** `bb81cf19…6e9f2` (block 15768)
- **4 SNARK proofs** deployed across blocks 15774→15784 (per-block detail in [`testnet-evidence.md`](testnet-evidence.md)).

## 5. Backend API

`tsx backend/api/main.ts` boots a Hono HTTP server that serves the entire off-ramp lifecycle as REST. The OpenAPI 3.0.3 spec is generated by [`backend/api/openapi.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/backend/api/openapi.ts) and exposed live at `/docs` (Swagger UI) and `/api/openapi.json` (machine-readable). All routes are documented in the [API reference](api-reference.md).

A live evaluation-window deployment is fronted by a TryCloudflare tunnel — see the [README](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments#live-mvp-evaluation-window-only) for the current URL. The tunnel is ephemeral; reproducing the run requires only `npm run dev` per the [quickstart](quickstart.md).

## 6. Issues fixed before release

| Issue | Fix | Where |
|---|---|---|
| `libsodium-wrappers-sumo` ESM resolution — npm publish layout puts `libsodium-sumo.mjs` in a sibling package; ESM build expects it next to `libsodium-wrappers.mjs`. | One-time shell fixup that copies the file into the expected location. | [`scripts/fix-libsodium.sh`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/fix-libsodium.sh) |
| Mock-mode rail rejection wasn't reflected in the harness summary cleanly. | Per-rail success-rate column + dedicated "Failures" section in the regenerated report. | [`scripts/internal-test.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/internal-test.ts) |
| Wise sandbox `/payments` SCA-gating. | Documented as expected provider-side behaviour; the SDK's responsibility ends at submitting the funding intent. | [`docs/sandbox-evidence/README.md`](sandbox-evidence/README.md) §"Step 5 note" |

## 7. Acceptance-criteria checklist

| Milestone criterion | Result | Evidence |
|---|---|---|
| Comprehensive developer docs published (integration, API reference, examples) | ✅ | [Docs site](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/) — index / quickstart / integration / api-reference / sdk-reference / examples / architecture |
| Final testing + release document with all test results, SDK link, docs link | ✅ | This page |
| Public GitHub repository with final SDK & docs | ✅ | <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments> |
| Recorded demo walkthrough video | ✅ | [`docs/media/offramp-demo.mp4`](media/offramp-demo.mp4) |
| Tagged release v1.0.0 | ✅ | [Release](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0) |
| Transaction success rate ≥ 90% | ✅ | 96.7% (29 / 30) — §1 above |
| Proof generation ≤ 50 000 ms (NFR-2) | ✅ | 744.6 ms avg — §1 above |
| Smart contracts deploy and function on Cardano testnet | ✅ | 5 Preprod txs — §2 above |
| Real sandbox provider integration | ✅ | Wise transfer `2147582543` — §3 above |
| Midnight ZK circuit deployed | ✅ | 4 SNARK proofs in blocks 15774→15784 — §4 above |

## 8. Released artefacts

- **`v1.0.0` GitHub Release** — source archive: <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0>
- **MIT LICENSE** — <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE>
- **CHANGELOG** — <https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/CHANGELOG.md>
- **Specifications:** [Project Initiation](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1 (canonical)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf)

## 9. Documentation link

**Hosted developer documentation:** <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/>

Rebuilt automatically on every change to `docs/` or `mkdocs.yml` via [`.github/workflows/docs.yml`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/.github/workflows/docs.yml). The site covers integration, API reference, SDK reference, runnable examples, architecture, and the test/release evidence — sufficient for an external team to integrate the SDK without reading the source.
