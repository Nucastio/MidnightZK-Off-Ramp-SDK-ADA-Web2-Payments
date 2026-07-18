# MidnightZK Off-Ramp SDK

Non-custodial **ADA → fiat off-ramps** for Cardano wallets and dApps, powered by:

- **Cardano PlutusV3 escrow** (Aiken) — locks user ADA with a structured inline `EscrowDatum`. `Release` requires an **oracle-signed, UTxO-bound release authorization** (Ed25519, verified on-chain) plus the operator signature, a validity window entirely before the deadline and the authorization expiry, and full escrow value paid to the datum-bound operator address. `Refund` is **deadline-gated**, sender-signed, and pays full value back to the datum-bound sender address. 25/25 Aiken tests.
- **Midnight execution via a required `MidnightProofProvider`** — the SDK **fails closed** without a real provider (no simulation fallback). Receipts carry finalized Midnight transaction/block identifiers and public contract state, pinned by the 23-asset circuit **artifact manifest hash** (`vkHash`).
- **Modular rail adapters** — **Wise** (strict sandbox client, no mock fallback), **Revolut** (live-sandbox verified: a real sandbox payment completed through the adapter), **Cash App** (implemented against the official Payouts API; **credential-gated early-access** — no live evidence yet). Deterministic mocks are test-only via `RAIL_ADAPTER_MODE=mock`.
- **Settlement Oracle** — Ed25519 signer that attests **adapter-observed** settlement and signs the on-chain release authorization.

> **Trust model:** Cardano does **not** verify Midnight SNARKs directly — release is authorized by an oracle signature that binds the Midnight settlement receipt hash to the exact escrow UTxO. Read [the trust model](trust-model.md) before integrating.

**Status:** v2.0.0 implementation. The v1.0.0 evidence pages are kept but marked **historical/superseded**.

## Where to start

| You are… | Start here |
|---|---|
| Integrating the SDK into a wallet / dApp | [Integration guide](integration.md) |
| Standing up the SDK locally | [Quickstart](quickstart.md) |
| Understanding what each layer proves | [Trust model](trust-model.md) |
| Reviewing release readiness | [Final testing & release](final-testing-and-release.md) |
| Reading the protocol | [Architecture](architecture.md) |
| Looking up a REST endpoint | [API reference](api-reference.md) |
| Looking up a TS class / function | [SDK reference](sdk-reference.md) |
| Running an end-to-end example | [Examples](examples.md) |

## Install + use

```bash
git clone https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cd MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments
cp .env.example .env       # fill in Blockfrost project id + mnemonics + oracle key
npm install
npm run dev                 # backend on $API_PORT (default 8788)
npm run serve:ui            # UI on http://127.0.0.1:5174
```

```ts
import { OffRampSDK } from "./sdk/src/index.ts";
import { createMidnightProofProviderFromEnv } from "./midnight-local-cli/src/index.ts";

const midnightProofProvider = createMidnightProofProviderFromEnv();
const sdk = new OffRampSDK({ senderPkh, operatorPkh, midnightProofProvider });
const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
  adapter: "revolut",
  payeeHandle: "revolut-counterparty",
  amountAda: 2,
  fiatAmount: "1.50",
  fiatCurrency: "GBP",
});
```

`midnightProofProvider` is **required** — construction throws without it, and the provider's artifact manifest hash must match the packaged SDK. See the full walkthrough in the [integration guide](integration.md).

## Test status (v2.0.0)

- **Aiken validator:** 25/25 (`npm run cardano:check`)
- **Lucid emulator suite:** 17/17 ([`sdk/test/escrow-emulator.test.mjs`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/test/escrow-emulator.test.mjs))
- **Backend API + oracle:** 15/15 (`npm run test:backend`)
- **E2E evidence:** [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0)

## Historical v1.0.0 evidence (superseded)

The v1.0.0 pages below are retained for the audit trail. Their headline claims were corrected in v2.0.0 — the v1 validator was signature-only (no deadline/settlement enforcement), the v1 SDK proof path was a SHA-256 simulation, the local Midnight run was placeholder-anchored, and the Wise transfer was never funded.

- [Final Testing & Release (v1.0.0, historical)](final-testing-and-release.md)
- [Cardano Preprod evidence (v1 validator, historical)](testnet-evidence.md)
- [Internal testing report (simulation harness)](internal-testing-report.md)
- [Wise sandbox evidence (unfunded transfer)](sandbox-evidence/README.md)

## License

MIT — see [LICENSE](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/LICENSE).
