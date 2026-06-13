# Architecture

Reference: [TAD v1.1 §3](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/docs/TAD_v1.1.pdf) (canonical) — TAD v1 is superseded.

## System overview

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

## Off-ramp lifecycle

**Initiate → Lock → Prove → Submit → Settle (Oracle) → Release** — or **Refund** after the deadline if the rail never settled.

| Step | Module | What happens |
|---|---|---|
| Initiate | [`sdk/src/sdk.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/sdk.ts) | Derives `payee_commitment` and `amount_commitment` (with random salts), the `adapter_tag`, the `intent_id` (binding sender PKH + commitments + `createdAt`), a `deadline`, and a frozen `vkHash`. **No on-chain state yet.** |
| Lock | [`sdk/src/cardano/lock.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/lock.ts) | Pays `ESCROW_LOCK_LOVELACE` into the escrow validator with inline `EscrowDatum`. |
| Prove | [`sdk/src/midnight/prove.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/midnight/prove.ts) | Generates a Midnight zk-SNARK proof binding payee + amount + (optional) compliance predicates, without revealing the underlying handles / amounts / KYC attributes. |
| Submit | [`sdk/src/adapters/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/adapters) | Routes through the chosen Cash App / Wise / Revolut adapter. Mode is `mock` (deterministic) or `sandbox` (real provider HTTP). Returns `railTxRef` + `webhookHmac`. |
| Settle | [`sdk/src/oracle/settlement-oracle.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/oracle/settlement-oracle.ts) | Verifies adapter HMAC, then Ed25519-signs a canonical attestation bound to `intent_id`. |
| Release | [`sdk/src/cardano/release.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/release.ts) | Operator-signed `RELEASE` redeemer spends the escrow UTxO. |
| Refund | [`sdk/src/cardano/refund.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/cardano/refund.ts) | Sender-signed `REFUND` redeemer spends the escrow UTxO back to the sender after the deadline. |

## On-chain components

### Escrow validator (Aiken Plutus V3)

- Source: [`cardano/escrow/validators/escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak)
- Blueprint: [`cardano/escrow/plutus.json`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/plutus.json) (compiler: Aiken v1.1.21)
- Preprod script address: `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`
- Redeemers: `Release` (operator-signed) · `Refund` (sender-signed)

The inline `EscrowDatum` carries `intent_id` (32-byte SHA-256), `payee_commitment`, `amount_commitment`, `adapter_tag`, `sender_pkh`, `operator_pkh`, `deadline`, `vk_hash`, and `principal_lovelace`. Five real Preprod transactions are recorded in [`testnet-evidence.md`](testnet-evidence.md).

### Midnight Compact circuit

- Source: [`contract/src/offramp.compact`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/contract/src/offramp.compact)
- Compiled artefacts (committed): [`contract/src/managed/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/contract/src/managed)
- Predicates: `provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`
- 4 SNARK proofs deployed on Midnight across blocks 15774→15784 (see [`testnet-evidence.md`](testnet-evidence.md) §"Midnight deploy").

## Off-chain components

- **Backend** ([`backend/api/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/backend/api)) — Hono HTTP server, OpenAPI / Swagger UI at `/docs`, in-memory intent store (see [API reference](api-reference.md)).
- **SDK** ([`sdk/src/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src)) — see [SDK reference](sdk-reference.md).
- **UI** ([`ui/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/ui)) — vanilla HTML/CSS/JS demo with a 6-step off-ramp pipeline view.
- **Midnight local CLI** ([`midnight-local-cli/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/midnight-local-cli)) — deploy + run-all helpers for the Midnight circuit.

## Trust model

| Surface | Trust |
|---|---|
| Cardano L1 | Trustless — non-custodial; sender keeps their key, operator only signs RELEASE after off-chain settlement. |
| Midnight ZK | Trustless w.r.t. payee + amount — circuit binds public inputs to commitments without revealing witnesses. |
| Rail adapter | Trusted webhook source — adapter signs canonical events with a shared secret (HMAC); the Settlement Oracle binds to those. |
| Settlement Oracle | Trusted Ed25519 signer — operator-owned, key in `OPERATOR_ED25519_SK_HEX`. Consumers verify with the published public key. |
| Backend HTTP | Optional; the SDK class can be used in-process, the backend is a convenience. |

## Versioning

The SDK is on **semantic versioning** starting at `v1.0.0`. Public API surface = the [SDK reference](sdk-reference.md) + the [REST API reference](api-reference.md). The Compact circuit is pinned by `vkHash` — bumping the circuit produces a new `vkHash` that public-input checks bind to.
