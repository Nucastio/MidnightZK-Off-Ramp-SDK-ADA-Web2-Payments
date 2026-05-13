# MidnightZK Off-Ramp SDK — ADA ⇆ Web2 Payments

Non-custodial ADA → fiat off-ramps for Cardano wallets and dApps, powered by:

- **Cardano PlutusV3 escrow** (Aiken) — locks user ADA with a structured inline `EscrowDatum`, releases on an operator-signed RELEASE redeemer, refunds on a sender-signed REFUND redeemer
- **Midnight zk-SNARK circuits** (Compact) — prove payee + amount + optional compliance predicates without revealing handles, fiat amounts, or KYC attributes
- **Modular rail adapters** for **Cash App (Afterpay)**, **Wise**, and **Revolut** — sandbox-first, with a stable `RailAdapter` interface that swaps in real provider HTTP calls when credentials are configured
- **Settlement Oracle** — Ed25519-signed canonical attestations that bind rail webhook events to `intent_id`

This repo ships the SDK, smart contract, sandbox integrations, Cardano testnet deployment, internal testing report, and demo video.

## Live MVP (Cardano Preprod + mock sandbox rails)

| Resource | URL |
|----------|-----|
| Live MVP Frontend (UI) | https://navigation-belt-revolution-excellent.trycloudflare.com |
| Live MVP Backend (API + Swagger) | https://curious-journalist-job-casio.trycloudflare.com/docs |
| Escrow validator (Preprod) | `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g` |
| Sample LOCK tx | [`f26f023d…fbc6c3`](https://preprod.cardanoscan.io/transaction/f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3) |
| Sample REFUND tx | [`a8c50ba9…c6d0b9`](https://preprod.cardanoscan.io/transaction/a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9) |
| Midnight contract address | `a3a72a55eb37317300a6c0718578a8e82040dacce3f139e23e1f52af99f77030` |
| Midnight deploy tx | `bb81cf19…6e9f2` (block 15768) |
| Midnight ZK circuit txs | 4 SNARK proofs (`provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`) across blocks 15774→15784 — see [`docs/testnet-evidence.md`](./docs/testnet-evidence.md) |


## Architecture (TAD §3)

```
            ┌──────────────────────────────┐
            │     Wallet / dApp (signer)   │
            └──────────────┬───────────────┘
                           │  HTTPS + typed SDK
            ┌──────────────▼───────────────┐
            │       SDK API Gateway        │
            │  (Hono, /api/offramp/*)      │
            └──┬──────────────┬──────┬─────┘
               │              │      │
               ▼              ▼      ▼
   ┌──────────────────┐ ┌──────────┐ ┌─────────────────┐
   │  ZK Worker pool  │ │ Adapters │ │ Settlement      │
   │  (Midnight       │ │ Cash App │ │ Oracle (Ed25519)│
   │   Compact)       │ │ Wise     │ │                 │
   └────────┬─────────┘ │ Revolut  │ └────────┬────────┘
            │           └────┬─────┘          │
            │                │                │
            ▼                ▼                ▼
       Cardano L1     Web2 sandbox     Signed attestations
       Escrow         (mock/sandbox)   bound to intent_id
       validator
```

Off-ramp lifecycle (TAD §4): `Initiate → Lock → Prove → Submit → Settle (Oracle) → Release` (or `Refund` after the deadline).

## Repository layout

```
cardano/escrow/        Aiken Plutus V3 escrow validator (plutus.json committed)
contract/src/          Midnight Compact contract sources + TS witness bindings
sdk/src/               Off-chain SDK (commitments, prover, adapters, oracle, Cardano builders)
backend/api/           Hono HTTP server + OpenAPI / Swagger
ui/                    Vanilla HTML/CSS/JS off-ramp UI
scripts/               Preprod deploy + internal test harness
docs/                  SRS / TAD / PID PDFs, testnet-evidence, internal-testing-report
```

## Quick start (local dev)

Prerequisites: Node.js 20+, [Aiken](https://aiken-lang.org) v1.1.21.

```bash
cp .env.example .env       # populate Blockfrost project id + mnemonic
npm install
bash scripts/fix-libsodium.sh    # one-time Lucid Evolution ESM fixup

npm run cardano:build            # rebuild plutus.json (already committed)
npm run dev                      # boots backend on $API_PORT (default 8801)
npm run serve:ui                 # serves ui/ on $UI_PORT (default 5181)
```

The UI opens at `http://127.0.0.1:5181` and the API docs at `http://127.0.0.1:8801/docs`.

## Running a real Preprod off-ramp

```bash
# 1. LOCK ADA at the escrow validator
npm run preprod:lock -- cashapp '$preprod_demo_user' 1.50 USD
# prints txHash + Cardanoscan link, writes data/preprod-evidence.json

# 2. (Optional) REFUND the LOCK output
npm run preprod:refund -- <lockTxHash>
```

Live Preprod tx evidence is recorded in [`docs/testnet-evidence.md`](./docs/testnet-evidence.md).

## Internal testing suite

```bash
npm run test:internal       # 10 runs × 3 rails = 30 simulated off-ramps
```

Writes [`docs/internal-testing-report.md`](./docs/internal-testing-report.md) and `data/testing-report.json`. The harness measures per-step latency, proof generation time (NFR-2 target ≤ 50 s), and per-rail success rate (acceptance ≥ 90%).

## Demo video

[`docs/media/offramp-demo.mp4`](./docs/media/offramp-demo.mp4) — Screen recording of the UI executing two end-to-end off-ramps (Cash App + Wise) and the internal test suite.

## Deliverables

| Output | Where |
|--------|-------|
| SDK + integration scripts for wallet / off-ramp apps | [`sdk/`](./sdk) + [`scripts/`](./scripts) |
| ZKP-based payee privacy mechanism | [`contract/src/offramp.compact`](./contract/src/offramp.compact) + [`sdk/src/midnight/prove.ts`](./sdk/src/midnight/prove.ts) |
| Smart contract deployment on Cardano testnet | [`cardano/escrow/`](./cardano/escrow) + [`docs/testnet-evidence.md`](./docs/testnet-evidence.md) |
| Sandbox integration with Cash App, Wise, Revolut | [`sdk/src/adapters/`](./sdk/src/adapters) |
| Internal testing report | [`docs/internal-testing-report.md`](./docs/internal-testing-report.md) |
| Demo video | [`docs/media/offramp-demo.mp4`](./docs/media/offramp-demo.mp4) |

## License

MIT — see [`LICENSE`](./LICENSE).
