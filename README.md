# MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments

[![Docs](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/actions/workflows/docs.yml/badge.svg)](https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/)
[![Release](https://img.shields.io/github/v/release/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments?include_prereleases&display_name=tag)](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Non-custodial ADA → fiat off-ramps for Cardano wallets and dApps:

- **Cardano PlutusV3 escrow** (Aiken, [`cardano/escrow/validators/escrow.ak`](./cardano/escrow/validators/escrow.ak)) — locks user ADA under an inline `EscrowDatum`. **Release** requires an **oracle-signed, UTxO-bound release authorization** (Ed25519 signature verified on-chain over the datum + the exact spending output reference + settlement digest + Midnight settlement-receipt hash + authorization expiry), the operator's signature, a validity window entirely before both the deadline and the authorization expiry, and **full escrow value paid to the datum-bound operator address**. **Refund** is deadline-gated (valid only at/after `deadline`), sender-signed, and pays full value back to the datum-bound sender address. **25/25 Aiken unit tests** (`npm run cardano:check`).
- **Midnight execution via a required `MidnightProofProvider`** — the production SDK **fails closed** without a real provider; there is no SHA-256 "simulation" path. Receipts (`MidnightIntentReceipt` / `MidnightSettlementReceipt`) carry **finalized Midnight transaction identifiers** (txId, txHash, blockHash, blockHeight) and the queried public contract state, all bound by a canonical `receiptHash`. The `vkHash` field is the deterministic **artifact manifest hash over the 23 compiled circuit assets** (provers, verifiers, ZKIR, contract-info) — a provider whose manifest hash differs from the packaged SDK is rejected at construction.
- **Modular rail adapters** — **Wise** (strict sandbox client: provider quote-bound transfers, deterministic idempotency keys, authenticated status, **no mock fallback in sandbox mode**), **Revolut** (live-sandbox **verified** — a real sandbox payment was completed through the adapter; refresh-token OAuth grant with a JWT whose `iss` is the certificate's redirect-URI domain), and **Cash App** (implemented against the official Cash App **Payouts API**; this is an **early-access partner product, credential-gated** — the integration is code-complete but has **no live evidence** until partner credentials are granted). Deterministic mock adapters exist **for tests only**, selected explicitly via `RAIL_ADAPTER_MODE=mock`.
- **Settlement Oracle** — Ed25519 signer that attests **adapter-observed** settlement (the backend queries the provider's authenticated status endpoint or verifies relayed provider webhook bytes; it never accepts a caller-asserted status) and signs the on-chain release authorization.
- **Backend** ([`backend/api/`](./backend/api)) — explicit lifecycle **state machine** (`CREATED → … → RELEASED`, with `PAYMENT_FAILED` / `REFUNDED` terminals), **per-intent capability-token auth**, adapter-observed settlement confirmation, and **PII redaction** (cleartext payee handles and salts are never persisted). **15/15 backend tests**.

> **Trust model (read this first):** Cardano does **not** verify Midnight SNARKs directly. The escrow validator verifies an **Ed25519 signature from the Settlement Oracle** over a message that binds the Midnight settlement-receipt hash and settlement digest to the exact escrow UTxO. The oracle/operator is a trusted role. Full honest statement of what each layer proves: [docs/trust-model.md](./docs/trust-model.md).

## Test status (v2.0.0 implementation)

| Suite | Command | Result |
|---|---|---|
| Aiken validator unit tests | `npm run cardano:check` | 25/25 |
| Lucid emulator on-chain suite ([`sdk/test/escrow-emulator.test.mjs`](./sdk/test/escrow-emulator.test.mjs)) | `npm test -w @nucast/midnightzk-offramp-sdk` | 17/17 |
| Backend API + oracle tests | `npm run test:backend` | 15/15 |
| Typecheck (all workspaces) | `npm run typecheck` | passes |

End-to-end on-chain evidence for v2.0.0 (Preprod lock → Midnight receipts → Revolut sandbox payout → oracle-authorized release, plus the deadline-gated refund path) is captured under [`docs/evidence/v2.0.0/`](./docs/evidence/v2.0.0/) (`e2e-run-1.json` / `e2e-run-1.md`, `e2e-refund-1.json` / `e2e-refund-1.md`).

## Architecture

```
            ┌──────────────────────────────┐
            │     Wallet / dApp (signer)   │
            └──────────────┬───────────────┘
                           │  HTTPS + typed SDK
            ┌──────────────▼───────────────┐
            │       SDK API Gateway        │
            │  (Hono, /api/offramp/*,      │
            │   capability-token auth)     │
            └──┬──────────────┬──────┬─────┘
               │              │      │
               ▼              ▼      ▼
   ┌──────────────────┐ ┌──────────┐ ┌─────────────────┐
   │ MidnightProof-   │ │ Adapters │ │ Settlement      │
   │ Provider (real   │ │ Wise     │ │ Oracle (Ed25519)│
   │ node+indexer+    │ │ Revolut  │ │ observes rails, │
   │ proof server)    │ │ Cash App │ │ signs release   │
   └────────┬─────────┘ └────┬─────┘ └────────┬────────┘
            │                │                │
            ▼                ▼                ▼
     Midnight ledger   Provider sandbox  UTxO-bound release
     (finalized txs    APIs (real HTTP)  authorization,
     in receipts)                        verified on-chain
                    Cardano L1 escrow validator
```

Lifecycle (backend state machine): `CREATED → LOCK_SUBMITTED → LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED → PAYMENT_SUBMITTED → SETTLEMENT_CONFIRMED → MIDNIGHT_SETTLEMENT_PROVED → RELEASE_AUTHORIZED → RELEASED`, with `REFUNDED` reachable after the deadline and `PAYMENT_FAILED` on a failed fiat leg.

## Repository layout

```
cardano/escrow/        Aiken Plutus V3 escrow validator + 25 unit tests (plutus.json committed)
contract/src/          Midnight Compact contract sources + compiled artifacts (23-asset manifest)
sdk/src/               Off-chain SDK (commitments, Midnight provider boundary, receipts,
                       adapters, oracle, Cardano tx builders)
sdk/test/              Lucid emulator suite (17 tests) + receipt/auth tests
backend/api/           Hono HTTP server: state machine, capability tokens, OpenAPI/Swagger
backend/test/          Backend API + oracle tests (15 tests)
midnight-local-cli/    Midnight deploy/run helpers + MidnightProofProvider factory
ui/                    Vanilla HTML/CSS/JS off-ramp UI
scripts/               Preprod lock/refund scripts, E2E evidence drivers, internal harness
docs/                  Developer docs (mkdocs), trust model, evidence
```

## Quick start (local dev)

Prerequisites: Node.js 20+, [Aiken](https://aiken-lang.org) v1.1.21 (only to rebuild `plutus.json`; it is committed), a Blockfrost Preprod project id, and — for real Midnight receipts — a reachable Midnight node + indexer + proof server (see [`midnight-local-cli/`](./midnight-local-cli)).

```bash
cp .env.example .env       # populate Blockfrost project id + mnemonics + oracle key
npm install                # postinstall runs scripts/fix-libsodium.sh

npm run cardano:build            # rebuild plutus.json (optional — committed)
npm run dev                      # boots backend on $API_PORT (default 8788)
npm run serve:ui                 # serves ui/ on port 5174
```

The UI opens at `http://127.0.0.1:5174` and the API docs at `http://127.0.0.1:8788/docs`.

## Running against Cardano Preprod

```bash
# LOCK ADA at the escrow validator
npm run preprod:lock -- cashapp '$preprod_demo_user' 1.50 USD
# prints txHash + Cardanoscan link, writes data/preprod-evidence.json

# REFUND the LOCK output (sender-signed; on-chain valid only after the deadline)
npm run preprod:refund -- <lockTxHash>
```

There is intentionally **no** standalone release npm script: a release requires stored settlement evidence (adapter-observed status + Midnight settlement receipt + oracle-signed authorization for the exact UTxO). The full happy path runs via the E2E driver:

```bash
npx tsx scripts/e2e-preprod.ts          # writes docs/evidence/v2.0.0/e2e-run-1.{json,md}
npx tsx scripts/e2e-preprod-refund.ts   # writes docs/evidence/v2.0.0/e2e-refund-1.{json,md}
```

## Test suites

```bash
npm run cardano:check       # 25 Aiken validator tests
npm test -w @nucast/midnightzk-offramp-sdk   # 17 Lucid emulator tests + receipt/auth tests
npm run test:backend        # 15 backend API + oracle tests
npm run typecheck           # all workspaces
npm run test:internal       # simulation harness (mock adapters; NOT provider evidence)
```

`test:internal` drives 30 **simulated** off-ramps with the deterministic mock adapters (`RAIL_ADAPTER_MODE=mock`). Its output ([`docs/internal-testing-report.md`](./docs/internal-testing-report.md)) measures harness latency only and is **not** evidence of live provider integration.

## Historical v1.0.0 evidence package (superseded)

> **Historical — superseded by v2.0.0.** The material below documents the v1.0.0 release as submitted and is kept for the audit trail. Known limitations of that release, corrected in v2.0.0:
>
> - The v1 validator was **signature-only**: Release checked only an operator signature and Refund only a sender signature — **no deadline enforcement, no settlement/oracle binding, no destination or value checks**. The recorded early REFUND succeeding *before* any deadline is itself a demonstration of the missing deadline enforcement.
> - The v1 "Midnight ZK proof" path in the SDK was a **SHA-256 digest simulation**, not SNARK execution; the local Midnight run was **placeholder-anchored** (circuit transactions were not bound to a real Cardano lock).
> - The v1 Wise sandbox transfer (`2147582543`) was created but **never funded** (SCA-gated; final state `incoming_payment_waiting`).
> - The mock adapters that produced the "30 simulated off-ramps, 96.7% success" figures were an in-process **simulation harness**, not live rails.

| Resource | URL |
|----------|-----|
| Documentation site (GitHub Pages) | <https://nucastio.github.io/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/> |
| Project Completion Report (PCR) | [PCR.pdf](./PCR.pdf) · [PCR.md](./PCR.md) |
| Project Completion Video (PCV) | [youtu.be/FDI2ymlPqXY](https://youtu.be/FDI2ymlPqXY) |
| Final Project Report | [FINAL_REPORT.md](./FINAL_REPORT.md) |
| Community campaign + engagement | [docs/community-engagement.md](./docs/community-engagement.md) |
| Final Testing & Release document | [markdown](./docs/final-testing-and-release.md) · [PDF](./docs/final-testing-and-release.pdf) |
| Internal testing report (simulation harness) | [docs/internal-testing-report.md](./docs/internal-testing-report.md) |
| Cardano Preprod evidence — v1 validator (superseded) | [docs/testnet-evidence.md](./docs/testnet-evidence.md) |
| Wise sandbox evidence (unfunded transfer) | [docs/sandbox-evidence/](./docs/sandbox-evidence/) |
| TAD v1.1 (canonical) — TAD v1 superseded | [docs/TAD_v1.1.pdf](./docs/TAD_v1.1.pdf) |
| CHANGELOG | [CHANGELOG.md](./CHANGELOG.md) |

The v1 "Live MVP" TryCloudflare URLs referenced in older documents were ephemeral evaluation-window tunnels and are offline.

## Deliverables

| Output | Where |
|--------|-------|
| SDK + integration scripts for wallet / off-ramp apps | [`sdk/`](./sdk) + [`scripts/`](./scripts) |
| ZK payee-privacy mechanism (Compact circuits + provider boundary + canonical receipts) | [`contract/src/offramp.compact`](./contract/src/offramp.compact) + [`sdk/src/midnight/`](./sdk/src/midnight) |
| Escrow validator with oracle-authorized release + deadline-gated refund | [`cardano/escrow/`](./cardano/escrow) |
| Sandbox integration with Wise, Revolut, Cash App | [`sdk/src/adapters/`](./sdk/src/adapters) |
| Trust model | [`docs/trust-model.md`](./docs/trust-model.md) |
| E2E evidence (v2.0.0) | [`docs/evidence/v2.0.0/`](./docs/evidence/v2.0.0/) |

## License

MIT — see [`LICENSE`](./LICENSE).
