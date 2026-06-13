# MidnightZK Off-Ramp SDK

Non-custodial **ADA → fiat off-ramps** for Cardano wallets and dApps, powered by:

- **Cardano PlutusV3 escrow** (Aiken) — locks user ADA with a structured inline `EscrowDatum`, releases on an operator-signed `RELEASE` redeemer, refunds on a sender-signed `REFUND` redeemer.
- **Midnight zk-SNARK circuits** (Compact) — prove payee + amount + optional compliance predicates **without revealing** handles, fiat amounts, or KYC attributes.
- **Modular rail adapters** — sandbox-first **Cash App (Afterpay)**, **Wise**, and **Revolut** with a stable `RailAdapter` interface that swaps in real provider HTTP calls when credentials are configured.
- **Settlement Oracle** — Ed25519-signed canonical attestations binding rail webhook events to `intent_id`.

> **Status:** Public **v1.0.0** release. MIT-licensed (Nucast Labs). Cardano Preprod evidence + Wise live-sandbox evidence committed in-repo.

## Where to start

| You are… | Start here |
|---|---|
| Integrating the SDK into a wallet / dApp | [Integration guide](integration.md) |
| Standing up the SDK locally | [Quickstart](quickstart.md) |
| Reviewing release readiness | [Final testing & release](final-testing-and-release.md) |
| Reading the protocol | [Architecture](architecture.md) |
| Looking up a REST endpoint | [API reference](api-reference.md) |
| Looking up a TS class / function | [SDK reference](sdk-reference.md) |
| Running an end-to-end example | [Examples](examples.md) |

## Install + use

```bash
git clone https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cd MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cp .env.example .env       # fill in Blockfrost project id + mnemonics
npm install
bash scripts/fix-libsodium.sh
npm run dev                 # backend on $API_PORT (default 8801)
npm run serve:ui            # UI on  $UI_PORT  (default 5181)
```

```ts
import { OffRampSDK } from "./sdk/src/index.ts";

const sdk = new OffRampSDK({ senderPkh, operatorPkh });
const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
  adapter: "cashapp",
  payeeHandle: "$alice",
  amountAda: 2,
  fiatAmount: "1.50",
  fiatCurrency: "USD",
});
```

See the full integration walkthrough in the [integration guide](integration.md).

## v1.0.0 evidence package

- **Repository:** [github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments)
- **Tagged release:** [v1.0.0](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/releases/tag/v1.0.0)
- **Final Testing & Release document:** [final-testing-and-release.md](final-testing-and-release.md)
- **Testnet evidence:** 5 real Preprod transactions — [testnet-evidence.md](testnet-evidence.md)
- **Internal testing report:** 30/30 simulated off-ramps, **avg prove 751 ms** — [internal-testing-report.md](internal-testing-report.md)
- **Wise sandbox evidence:** 6 raw provider responses — [sandbox-evidence/README.md](sandbox-evidence/README.md)
- **Demo recording:** [media/offramp-demo.mp4](media/offramp-demo.mp4)
- **Specifications:** [Project Initiation](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/Project_Initiation_Document_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [SRS](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/SRS_-_MidnightZK_Off-Ramp_SDK_ADAWeb2_Payments_(Cash_App_Wise).pdf) · [TAD v1.1 — canonical](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf)

## Live MVP (evaluation-window only)

The README and several docs reference TryCloudflare URLs (`*.trycloudflare.com`). Those are **ephemeral quick-tunnels** tied to a local process and may go offline outside the evaluation window. To reproduce locally, follow [the quickstart](quickstart.md).

## License

MIT — see [LICENSE](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE).
