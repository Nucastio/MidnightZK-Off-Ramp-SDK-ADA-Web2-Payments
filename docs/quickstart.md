# Quickstart

Stand up the SDK locally — backend, UI, test suites, and (optionally) a real Preprod LOCK + REFUND.

## Prerequisites

- **Node.js 20+**
- **[Aiken](https://aiken-lang.org) v1.1.21** (only if you want to rebuild the Plutus blueprint; `plutus.json` is committed)
- A free [Blockfrost](https://blockfrost.io) **Preprod** project id
- A 24-word **Cardano Preprod** mnemonic (faucet-funded) for the sender/operator
- For **real Midnight receipts**: a reachable Midnight node + indexer + proof server and a 24-word **Midnight** mnemonic (`BIP39_MNEMONIC`). The SDK's `MidnightProofProvider` boundary is **required** — proving fails closed without it; there is no simulation fallback.

## 1. Install

```bash
git clone https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cd MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cp .env.example .env
$EDITOR .env                # populate Blockfrost project id + mnemonics + oracle key
npm install                 # postinstall runs scripts/fix-libsodium.sh automatically
```

## 2. Environment

Key variables from [`.env.example`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/.env.example):

| Variable | Purpose |
|---|---|
| `BLOCKFROST_PROJECT_ID` | Preprod Blockfrost project id |
| `WALLET_MNEMONIC` / `SENDER_WALLET_MNEMONIC` / `OPERATOR_WALLET_MNEMONIC` | Funded Preprod mnemonics |
| `OPERATOR_ED25519_SK_HEX` | 32-byte hex Settlement Oracle signing key (release authorizations + attestations) |
| `RAIL_WEBHOOK_HMAC_KEY` | Shared HMAC key for adapter webhook verification — **required; the oracle fails closed when unset** |
| `BIP39_MNEMONIC` + `MIDNIGHT_*` | Midnight wallet + node/indexer/proof-server endpoints for the real proof provider |
| `API_PORT` | Backend port (default **8788**) |
| `UI_PORT` | UI port (default **5174**) |
| `ESCROW_DEADLINE_SECONDS` | Refund deadline window (default 900 s) |
| `ESCROW_LOCK_LOVELACE` | Escrow size (default 2 ADA) |
| `RAIL_ADAPTER_MODE` | `sandbox` (real provider HTTP) or `mock` (**test-only** deterministic simulators) |
| `OFFRAMP_RELEASE_AUTH_WINDOW_MS` | Release-authorization validity window (default 600 000 ms) |

## 3. Run the backend + UI

```bash
npm run cardano:build         # rebuild plutus.json (optional — committed)
npm run dev                   # boots Hono backend on $API_PORT (default 8788)
# in a second terminal:
npm run serve:ui              # serves ui/ on port 5174
```

Open:

- **UI:** `http://127.0.0.1:5174`
- **API + Swagger UI:** `http://127.0.0.1:8788/docs`
- **OpenAPI JSON:** `http://127.0.0.1:8788/api/openapi.json`

The API uses **per-intent capability tokens**: `POST /api/offramp/initiate` returns a `capabilityToken` exactly once, and every subsequent mutation (and `GET /api/intents/{id}`) requires it via the `X-Capability-Token` header. See the [API reference](api-reference.md).

## 4. Run the test suites

```bash
npm run cardano:check       # 25/25 Aiken validator unit tests
npm test -w @nucast/midnightzk-offramp-sdk
                            # 17/17 Lucid emulator on-chain tests + receipt/auth tests
npm run test:backend        # 15/15 backend API + oracle tests
npm run typecheck           # all workspaces
```

`npm run test:internal` additionally runs a 30-run **simulation harness** against the deterministic mock adapters — useful as a smoke test, but it is **not** live-provider evidence.

## 5. Run a real Preprod LOCK / REFUND

```bash
# LOCK ADA at the escrow validator
npm run preprod:lock -- cashapp '$preprod_demo_user' 1.50 USD
# Prints txHash + Cardanoscan link, appends to data/preprod-evidence.json

# REFUND a LOCK output (sender-signed; the validator only accepts it at/after the deadline)
npm run preprod:refund -- <lockTxHash>
```

There is intentionally **no** `preprod:release` npm script — a release cannot be produced from a tx hash alone. It requires adapter-observed settlement, a Midnight settlement receipt, and an oracle-signed authorization bound to the exact escrow UTxO. The full happy path (lock → Midnight receipts → Revolut sandbox payout → oracle-authorized release) runs via the E2E driver:

```bash
npx tsx scripts/e2e-preprod.ts          # evidence → docs/evidence/v2.0.0/e2e-run-1.{json,md}
npx tsx scripts/e2e-preprod-refund.ts   # evidence → docs/evidence/v2.0.0/e2e-refund-1.{json,md}
```

## 6. Live sandbox adapters

```bash
export RAIL_ADAPTER_MODE=sandbox
```

- **Wise** — strict sandbox client against `https://api.wise-sandbox.com`: provider quote-bound transfers, deterministic idempotency (`customerTransactionId`), authenticated status, webhook signature verification. **No mock fallback** — missing configuration is a hard error. Requires a fresh `WISE_API_TOKEN` plus `WISE_PROFILE_ID`, `WISE_RECIPIENT_ID`, `WISE_SOURCE_CURRENCY`, `WISE_WEBHOOK_PUBLIC_KEY_PEM`.
- **Revolut** — live sandbox **verified**: a real sandbox payment was completed through this adapter. Auth is the business-API refresh-token grant (`REVOLUT_CLIENT_ID`, `REVOLUT_PRIVATE_KEY_PEM`/`_PATH`, `REVOLUT_REFRESH_TOKEN`, `REVOLUT_JWT_ISSUER` — the JWT `iss` must be the certificate's OAuth redirect-URI domain, `REVOLUT_SOURCE_ACCOUNT_ID`, and a counterparty).
- **Cash App** — implemented against the **official Cash App Payouts API** (`sandbox.api.cash.app`). This is an **early-access partner product**: the integration is code-complete but **credential-gated**, so there is no live evidence until Cash App grants partner credentials. It must not be represented as live-tested.

Mock adapters (`RAIL_ADAPTER_MODE=mock`) are deterministic in-process simulators for tests and CI only.

## Next

- The [integration guide](integration.md) walks through the SDK call surface end-to-end.
- The [trust model](trust-model.md) explains exactly what each layer proves.
- The [examples](examples.md) page runs the full lifecycle in code.
