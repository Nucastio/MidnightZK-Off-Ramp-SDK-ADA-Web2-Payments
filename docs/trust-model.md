# Trust Model

An honest statement of what each layer of the MidnightZK Off-Ramp proves, who holds which keys, and what remains assumed. Read this before integrating.

**The single most important fact:** the Cardano escrow validator does **not** verify Midnight zk-SNARKs directly. Plutus cannot run the Midnight verifier. Instead, release is authorized by an **Ed25519 signature from the Settlement Oracle** over a canonical message that binds the Midnight settlement-receipt hash and the settlement digest to the exact escrow UTxO. On-chain SNARK verification would require the oracle's role to be replaced by a proof-verification primitive that Cardano does not currently provide for Midnight proofs — the oracle is the explicit, auditable trust bridge.

## Roles and keys

| Role | Key | Held by | Used for |
|---|---|---|---|
| **Sender** (end user) | Cardano payment key (`sender_pkh` in the datum) | User's wallet | Signing the LOCK; signing the REFUND (the only key that can recover funds after the deadline) |
| **Operator** | Cardano payment key (`operator_pkh`) | Off-ramp operator | Signing the RELEASE tx (fees + `extra_signatories`); receives the escrow on release |
| **Settlement Oracle** | Ed25519 key (`OPERATOR_ED25519_SK_HEX`; public key pinned in the datum as `oracle_public_key`) | Off-ramp operator (may be the same party as the operator) | Signing settlement attestations and the on-chain-verified `ReleaseAuthorization` |
| **Midnight prover wallet** | Midnight BIP-39 mnemonic (`BIP39_MNEMONIC`) | Off-ramp operator / prover host | Funding + submitting Midnight circuit transactions via the proof provider |
| **Rail provider** | Provider credentials (Wise token, Revolut client cert + refresh token, Cash App partner credentials) | Off-ramp operator | Executing and observing the fiat leg |
| **Backend capability token** | Per-intent random token (SHA-256 hash stored server-side) | The client that initiated the intent | Authorizing all subsequent mutations of that intent over HTTP |

## What each layer proves

### Cardano escrow validator (`cardano/escrow/validators/escrow.ak`, 25/25 tests)

Enforced **on-chain**, per spend:

- **Release** requires, all together:
    - the operator's signature on the transaction;
    - a non-empty validity range entirely **before** the datum `deadline` **and** before the authorization's `authorization_expiry`;
    - **full input value** paid to the address derived from `operator_pkh` (no partial skims);
    - a valid Ed25519 signature by the datum's `oracle_public_key` over the canonical, domain-separated `ReleaseAuthorizationMessage`, which serializes **every datum field**, the **exact spending `OutputReference`** (making each authorization single-use — no replay across UTxOs), the `settlement_digest`, the `midnight_settlement_receipt_hash`, and the `authorization_expiry`;
    - well-formedness of all datum/authorization byte lengths.
- **Refund** requires: the sender's signature, a validity range at/after the `deadline`, and **full input value** returned to the address derived from `sender_pkh`.

What this proves: escrow funds can move **only** to the two datum-pinned destinations; the operator path additionally requires a fresh, UTxO-specific oracle authorization that commits to a specific Midnight settlement receipt; the sender can always recover funds after the deadline without anyone's cooperation.

What it does **not** prove: that the settlement receipt is *true* — the chain verifies the oracle *signed* it, not the underlying fiat event or SNARK.

### Midnight circuits + receipts (`contract/src/offramp.compact`, `sdk/src/midnight/`)

- The Compact circuits (`bindOffRampIntent`, `provePayeeBinding`, `proveAmountBinding`, `proveComplianceFlag`, `proveOffRampSettlement`) are executed on a Midnight node through the **required `MidnightProofProvider`**; the Midnight ledger's verifier accepts the SNARKs before the state transitions land.
- Receipts (`MidnightIntentReceipt` / `MidnightSettlementReceipt`) carry **finalized public evidence only**: per-circuit txId/txHash/blockHash/blockHeight, the queried public contract state, and a canonical `receiptHash`. Witnesses (payee handle, salts) never appear in receipts.
- The circuit build is pinned by a deterministic **artifact manifest hash over the 23 compiled assets** (`vkHash()` = on-chain `circuit_artifact_hash`). The SDK refuses a provider whose manifest hash differs, and receipt validation re-checks it.
- The production SDK **fails closed**: there is no digest-simulation fallback (`prove`/`verify` throw without a provider).

What this proves: on the Midnight ledger, *someone knowing the payee/amount witnesses behind the on-chain commitments* executed the circuits for this `intent_id`, anchored to the Cardano lock tx, with a specific settlement digest.

### Settlement Oracle (`sdk/src/oracle/settlement-oracle.ts`)

- Attests only **adapter-observed** provider states: the backend queries the provider's authenticated status API, or verifies raw provider webhook bytes via the adapter's `verifyWebhook` (provider signature schemes), before the oracle signs. Caller-asserted statuses are rejected at the API boundary.
- Signs the `ReleaseAuthorization` for the exact escrow UTxO, with a bounded validity window (`OFFRAMP_RELEASE_AUTH_WINDOW_MS`).
- `RAIL_WEBHOOK_HMAC_KEY` and `OPERATOR_ED25519_SK_HEX` are fail-closed required configuration; only the public key is published.

### Rail adapters (`sdk/src/adapters/`)

- **Wise** — strict sandbox client: provider quote-bound transfer creation, deterministic idempotency keys, authenticated status, webhook verification, **no mock fallback**. Live evidence pending a fresh sandbox token.
- **Revolut** — live sandbox **verified**: a real sandbox payment was completed through the adapter.
- **Cash App** — implemented against the official Payouts API; **credential-gated early-access** partner product, so no live evidence exists yet, and none is claimed.
- **Mocks** — deterministic simulators available only via `RAIL_ADAPTER_MODE=mock`; test/CI use only.

### Backend (`backend/api/`, 15/15 tests)

- Explicit lifecycle state machine (409 on skipped states, idempotent replays).
- Per-intent capability tokens (returned once; only hashes persisted).
- PII redaction: cleartext payee handles and salts are never persisted or re-returned.
- Release/refund spend only the stored lock UTxO with datum-bound destinations; caller overrides rejected.

## Residual assumptions and limitations

1. **The oracle + operator are trusted for the release path.** If both the oracle Ed25519 key and the operator wallet are compromised (they may be held by the same party), an attacker could authorize a release **without** a genuine settlement. They still could not redirect funds anywhere except the datum-pinned operator address, and could never block the sender's post-deadline refund.
2. **Cardano does not verify SNARKs.** The on-chain binding to Midnight is the oracle-signed settlement-receipt hash — an *attestation* about a Midnight receipt, not on-chain proof verification.
3. **Fiat truth comes from providers.** Settlement is as trustworthy as the provider's authenticated status API / signed webhooks. A provider misreporting a payout would propagate into the attestation.
4. **Liveness of the operator.** If the operator disappears before releasing, the sender waits until the deadline and refunds; if the fiat payout already happened, the operator (not the user) bears that loss — the design fails toward the user.
5. **Midnight network scope.** The proof provider currently targets a local/undeployed Midnight network configuration; receipts are real finalized Midnight ledger data, but public-testnet deployment is environment configuration, not yet standing public infrastructure.
6. **Adapter evidence asymmetry.** Only Revolut has live-sandbox payment evidence today; Wise is code-complete pending a fresh token; Cash App is credential-gated. Claims are labeled accordingly throughout the docs.
7. **Key management is out of scope.** `OPERATOR_ED25519_SK_HEX`, mnemonics, and provider credentials live in environment configuration; production deployments need an HSM/KMS story and key-rotation procedure (rotation currently means new locks with a new `oracle_public_key` in the datum).
8. **No external security audit yet.** The validator and oracle have unit/emulator coverage (25 + 17 + 15 tests) but no third-party audit; mainnet use is not recommended until one is done.
