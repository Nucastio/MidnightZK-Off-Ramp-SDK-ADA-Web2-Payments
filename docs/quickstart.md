# Quickstart

Stand up the SDK locally — backend, UI, and (optionally) a real Preprod LOCK + REFUND.

## Prerequisites

- **Node.js 20+**
- **[Aiken](https://aiken-lang.org) v1.1.21** (only if you want to rebuild the Plutus blueprint; `plutus.json` is committed)
- A free [Blockfrost](https://blockfrost.io) **Preprod** project id
- A 24-word **Cardano Preprod** mnemonic (faucet-funded) for the sender/operator
- A 24-word **Midnight** mnemonic if you want to redeploy the ZK contract

## 1. Install

```bash
git clone https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cd MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cp .env.example .env
$EDITOR .env                # populate Blockfrost project id + mnemonics
npm install
bash scripts/fix-libsodium.sh   # one-time Lucid Evolution ESM fixup
```

## 2. Environment

Key variables from [`.env.example`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/.env.example):

| Variable | Purpose |
|---|---|
| `BLOCKFROST_PROJECT_ID` | Preprod Blockfrost project id |
| `WALLET_MNEMONIC` / `SENDER_WALLET_MNEMONIC` / `OPERATOR_WALLET_MNEMONIC` | Funded Preprod mnemonics |
| `OPERATOR_ED25519_SK_HEX` | 32-byte hex for the Settlement Oracle signing key |
| `API_PORT` | Backend port (default 8801 in v1) |
| `UI_PORT` | UI port (default 5181 in v1) |
| `ESCROW_DEADLINE_SECONDS` | Refund deadline window (default 900 s) |
| `ESCROW_LOCK_LOVELACE` | Min-ADA escrow size (default 2 ADA) |
| `RAIL_ADAPTER_MODE` | `mock` (deterministic) or `sandbox` (real provider HTTP) |

## 3. Run the backend + UI

```bash
npm run cardano:build         # rebuild plutus.json (optional — committed)
npm run dev                   # boots Hono backend on $API_PORT
# in a second terminal:
npm run serve:ui              # serves ui/ on $UI_PORT
```

Open:

- **UI:** `http://127.0.0.1:5181`
- **API + Swagger UI:** `http://127.0.0.1:8801/docs`
- **OpenAPI JSON:** `http://127.0.0.1:8801/api/openapi.json`

The Swagger UI mirrors every route documented in the [API reference](api-reference.md).

## 4. Run a real Preprod off-ramp

The repo ships three runnable example scripts under [`scripts/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/scripts):

```bash
# LOCK ADA at the escrow validator
npm run preprod:lock -- cashapp '$preprod_demo_user' 1.50 USD
# Prints txHash + Cardanoscan link, appends to data/preprod-evidence.json

# REFUND a LOCK output (sender-signed)
npm run preprod:refund -- <lockTxHash>

# RELEASE a LOCK output (operator-signed)
npm run preprod:release -- <lockTxHash>
```

Real run outputs are recorded in [`docs/testnet-evidence.md`](testnet-evidence.md).

## 5. Run the internal test suite

```bash
npm run test:internal       # 30 simulated off-ramps (10 × cashapp / wise / revolut)
```

Writes [`docs/internal-testing-report.md`](internal-testing-report.md) + `data/testing-report.json`.

## 6. (Optional) Switch to live sandbox adapters

```bash
export RAIL_ADAPTER_MODE=sandbox
export WISE_API_TOKEN=<your-wise-sandbox-token>      # https://sandbox.transferwise.tech
# Cash App: the v1 adapter uses Afterpay sandbox semantics —
# see https://www.postman.com/afterpay-1-426879/afterpay-online-apis-v2
```

Captured live-sandbox runs are committed under [`docs/sandbox-evidence/`](sandbox-evidence/README.md).

## Next

- The [integration guide](integration.md) walks through the SDK call surface end-to-end.
- The [examples](examples.md) page runs the full lifecycle in code.
