# Architecture

Reference: [TAD v1.1 §3](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf) (canonical) — TAD v1 is superseded. Where this page and the TAD disagree, the shipped v2.0.0 implementation described here is authoritative.

## System overview

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
   │ Provider (node + │ │ Wise     │ │ Oracle (Ed25519)│
   │ indexer + proof  │ │ Revolut  │ │ observes rails, │
   │ server)          │ │ Cash App │ │ signs release   │
   └────────┬─────────┘ └────┬─────┘ └────────┬────────┘
            │                │                │
            ▼                ▼                ▼
     Midnight ledger   Provider sandbox  UTxO-bound release
     (finalized txs    APIs (real HTTP)  authorizations
     in receipts)
                    Cardano L1 escrow validator
```

## Off-ramp lifecycle

The backend enforces an explicit state machine ([`backend/api/lifecycle.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/backend/api/lifecycle.ts)):

```
CREATED → LOCK_SUBMITTED → LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED
        → PAYMENT_SUBMITTED → SETTLEMENT_CONFIRMED → MIDNIGHT_SETTLEMENT_PROVED
        → RELEASE_AUTHORIZED → RELEASED
```

Terminals: `RELEASED`, `PAYMENT_FAILED`, `REFUNDED` (refund also recovers escrow from `PAYMENT_FAILED` after the deadline). Every mutation validates the source state (409 on a skip) and is idempotent.

| Step | Module | What happens |
|---|---|---|
| Initiate | [`sdk/src/sdk.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/sdk.ts) | Derives `payee_commitment`, `amount_commitment` (with random salts), `adapter_tag`, `intent_id` (binding sender PKH + commitments + `createdAt`), a `deadline`, and the artifact-manifest `vkHash`. **No on-chain state yet.** |
| Lock | [`sdk/src/cardano/lock.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/lock.ts) | Pays the escrow into the validator with an inline, well-formed `EscrowDatum` (see below). |
| Prove | [`sdk/src/midnight/prove.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/midnight/prove.ts) | Executes the Midnight Compact circuits through the **required `MidnightProofProvider`** (real node + indexer + proof server). The returned `MidnightIntentReceipt` carries finalized tx/block identifiers for deploy, `bindOffRampIntent`, `provePayeeBinding`, `proveAmountBinding` (and optionally `proveComplianceFlag`), the queried public contract state, and a canonical `receiptHash`. Proving **fails closed** without a provider. |
| Submit | [`sdk/src/adapters/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/adapters) | Routes through the Wise / Revolut / Cash App adapter (`RAIL_ADAPTER_MODE=sandbox` for real provider HTTP; `mock` is test-only). Returns a provider reference for authenticated status polling. |
| Settle | [`backend/api/app.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/backend/api/app.ts) + [`sdk/src/oracle/settlement-oracle.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/oracle/settlement-oracle.ts) | The server obtains the provider status **through the adapter** (authenticated `getStatus` or verified provider webhook bytes) — caller-asserted statuses are rejected — then the oracle Ed25519-signs a canonical attestation, and the SDK generates the Midnight settlement receipt (`proveOffRampSettlement`). |
| Release | [`sdk/src/cardano/release.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/release.ts) | The oracle signs a `ReleaseAuthorization` bound to the **exact escrow UTxO**; the operator submits the `Release` redeemer within a validity window ending before both the deadline and the authorization expiry, paying full escrow value to the datum-bound operator address. |
| Refund | [`sdk/src/cardano/refund.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/refund.ts) | Sender-signed `Refund` redeemer, on-chain valid only at/after the deadline, paying full escrow value back to the datum-bound sender address. |

## On-chain components

### Escrow validator (Aiken Plutus V3)

- Source: [`cardano/escrow/validators/escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak) — **25/25 unit tests** (`npm run cardano:check`)
- Blueprint: [`cardano/escrow/plutus.json`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/plutus.json) (compiler: Aiken v1.1.21)

Inline `EscrowDatum` (all lengths enforced on-chain):

| Field | Type |
|---|---|
| `intent_id` | 32-byte hash |
| `payee_commitment` | 32-byte hash |
| `amount_commitment` | 32-byte hash |
| `adapter_id` | 32-byte hash of the rail id |
| `deadline` | POSIX ms |
| `circuit_artifact_hash` | 32-byte Midnight artifact-manifest hash (the SDK's `vkHash`) |
| `sender_pkh` | 28-byte payment key hash |
| `operator_pkh` | 28-byte payment key hash |
| `oracle_public_key` | 32-byte Ed25519 public key |

Redeemers:

- **`Release(ReleaseAuthorization)`** — validates on-chain that (1) the operator signed the tx, (2) the tx validity range is non-empty and entirely before both `deadline` and `authorization_expiry`, (3) **full input value** is paid to the address derived from `operator_pkh`, and (4) `oracle_signature` is a valid Ed25519 signature by `oracle_public_key` over the canonical `ReleaseAuthorizationMessage` — a domain-separated `serialise_data` payload binding **every datum field plus the exact spending `OutputReference`**, the `settlement_digest`, the `midnight_settlement_receipt_hash`, and the `authorization_expiry`. Binding the output reference makes each authorization single-use (no replay across UTxOs).
- **`Refund`** — validates that the sender signed, the validity range lies at/after `deadline`, and full input value returns to the address derived from `sender_pkh`.

### Midnight Compact circuits

- Source: [`contract/src/offramp.compact`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/contract/src/offramp.compact)
- Compiled artifacts (committed): [`contract/src/managed/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/contract/src/managed) — the SDK pins a deterministic **manifest hash over the 23 compiled assets** (provers, verifiers, ZKIR, contract-info); a `MidnightProofProvider` with a different manifest hash is rejected at SDK construction.
- Circuits: `bindOffRampIntent`, `provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`.

## Off-chain components

- **Backend** ([`backend/api/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/backend/api)) — Hono HTTP server: lifecycle state machine, per-intent capability-token auth, adapter-observed settlement, PII-redacting persistence (cleartext payee handles and salts are never stored), OpenAPI/Swagger at `/docs`. **15/15 tests** (`npm run test:backend`).
- **SDK** ([`sdk/src/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src)) — see the [SDK reference](sdk-reference.md). The Cardano builders are exercised end-to-end on an in-process Lucid emulator: **17/17** ([`sdk/test/escrow-emulator.test.mjs`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/test/escrow-emulator.test.mjs)).
- **UI** ([`ui/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/ui)) — vanilla HTML/CSS/JS demo (port 5174).
- **Midnight local CLI** ([`midnight-local-cli/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/midnight-local-cli)) — deploy/run helpers and the `createMidnightProofProviderFromEnv()` factory for the real proof provider.

## Trust model (summary)

Full statement: [Trust model](trust-model.md).

| Surface | Trust |
|---|---|
| Cardano L1 escrow | Enforced on-chain: oracle-signed UTxO-bound release authorization, operator signature, deadline + expiry windows, exact destinations, full value preservation. **Cardano does not verify Midnight SNARKs directly** — it verifies the oracle's Ed25519 signature over a message that includes the Midnight settlement-receipt hash. |
| Midnight | SNARK circuits prove payee/amount/compliance bindings; receipts carry finalized ledger evidence and are verified against the pinned artifact manifest. |
| Settlement Oracle / operator | **Trusted role.** It only attests provider states it observed through the adapter, but a compromised oracle key + operator key could authorize an undeserved release (never a theft of the refund path — refunds need only the sender + deadline). |
| Rail providers | Trusted for fiat-side truth; the backend reads their authenticated status APIs / verified webhooks. |
| Backend HTTP | Optional convenience; the SDK class can be used in-process. Capability tokens gate all per-intent mutations. |

## Versioning

Semantic versioning. Public surface = [SDK reference](sdk-reference.md) + [REST API reference](api-reference.md). The Midnight circuit set is pinned by the artifact-manifest hash (`vkHash`, on-chain as `circuit_artifact_hash`) — recompiling the circuits produces a new manifest hash, which both the SDK constructor and the receipt validators check.
