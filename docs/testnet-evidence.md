# Testnet Evidence — v1.0.0 (historical, superseded)

!!! warning "Historical v1.0.0 evidence — superseded by v2.0.0"
    Everything on this page was produced against the **v1.0.0 validator and SDK** and is retained for the audit trail only. Corrections:

    - The v1 validator was **signature-only**: `Release` checked only an operator signature and `Refund` only a sender signature. It enforced **no deadline, no settlement/oracle binding, no destination, and no value preservation**. In particular, the recorded REFUND below succeeded **without any deadline enforcement** — it is evidence of the gap, not of deadline handling.
    - The RELEASE below required nothing beyond the operator's signature — settlement was never verified on-chain.
    - The Midnight run below executed real SNARK circuits on a **local devnet**, but it was **placeholder-anchored**: the circuit inputs were not bound to a real Cardano lock transaction, and the SDK's own `prove()` path at v1.0.0 was a SHA-256 digest simulation, not SNARK execution.
    - The v1 datum used `vk_hash` as a free-standing identifier; in v2 the corresponding field is `circuit_artifact_hash` — the deterministic manifest hash over the 23 compiled circuit assets — and the datum additionally carries the oracle's Ed25519 public key.

    The remediated validator (oracle-signed UTxO-bound release authorization, deadline-gated refund, exact destinations, full value preservation; 25/25 Aiken tests, 17/17 Lucid-emulator tests) is documented in the [architecture page](architecture.md), and v2.0.0 end-to-end evidence is captured under [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0).

This document records the on-chain artifacts submitted with v1.0.0 for the Cardano-side acceptance criterion.

All transactions are on **Cardano Preprod** and were submitted from the same demo wallet used by the Nucast Cardano sibling projects.

## Escrow validator (v1 — superseded)

- **Source (current, remediated):** [`cardano/escrow/validators/escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak) — note the file now contains the v2 validator; the address below belongs to the **old v1 script**
- **Plutus version:** V3 · **Compiler:** Aiken v1.1.21
- **v1 script address (Preprod):** `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`
- **v1 validator paths:** `Release` (operator signs — *only* check) · `Refund` (sender signs — *only* check)

## Recorded v1 Preprod transactions (old validator)

| Step | Adapter | Tx hash | Cardanoscan |
|------|---------|---------|-------------|
| LOCK #1 | Cash App | `f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3` | [view](https://preprod.cardanoscan.io/transaction/f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3) |
| REFUND  | (spend of LOCK #1, sender-signed — **accepted with no deadline check**) | `a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9` | [view](https://preprod.cardanoscan.io/transaction/a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9) |
| LOCK #2 | Wise | `03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869` | [view](https://preprod.cardanoscan.io/transaction/03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869) |
| LOCK #3 | Wise | `b55e48084290f6b88b8fd6489f40e65acc50664fba4873feb1248dffbcb64ac2` | [view](https://preprod.cardanoscan.io/transaction/b55e48084290f6b88b8fd6489f40e65acc50664fba4873feb1248dffbcb64ac2) |
| RELEASE | (spend of LOCK #3, operator-signed — **no settlement/oracle/deadline/value checks**) | `c84c242d6f86dbdac54ded62c92bbdc88b5725722d1691728854e20d62bd3168` | [view](https://preprod.cardanoscan.io/transaction/c84c242d6f86dbdac54ded62c92bbdc88b5725722d1691728854e20d62bd3168) |

These five transactions exercised the **v1** validator surface, which consisted solely of the two signature checks. They do **not** demonstrate deadline handling, settlement binding, destination binding, or value preservation — none of which existed in v1. Those properties are enforced by the v2 validator and covered by its 25 Aiken tests and the 17-test Lucid emulator suite.

## v1 datum shape recorded on-chain (superseded)

The v1 inline `EscrowDatum` in each LOCK tx carried:

| Field | Type | Example (LOCK #1) |
|-------|------|-------------------|
| `intent_id` | 32-byte SHA-256 | `294699e3a4436bf04d1bc9400a3bf0a5a94c2e7d8918a059b81e19fc1dc6d3d8` |
| `payee_commitment` | 32-byte SHA-256 | `4ba5d24207ecbb6842f57929cc48b9196a1954da3de4f11c8b5a297d0b7761b0` |
| `amount_commitment` | 32-byte SHA-256 | `d4028c6df510932516a19d8b95fd14f53a39747f862fe7c7e108f5323c6bc141` |
| `adapter_id` | 32-byte SHA-256 of `"cashapp"` | `d3b5c87980e519ad8ed4ddd8275bd5e7f831ad2b504b45d74d40c4968a635f4e` |
| `deadline` | POSIX ms (**not enforced by the v1 validator**) | `1778689529000` |
| `vk_hash` | 32-byte (v2: `circuit_artifact_hash` = 23-asset manifest hash) | `a426f535acbf4f65b39ccb0bc0c05f798b064b78d342e174c7501fb5c64f7630` |
| `sender_pkh` | 28-byte | `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c` |
| `operator_pkh` | 28-byte | `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c` |

The v2 datum ([`escrow.ak`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/cardano/escrow/validators/escrow.ak)) is: `intent_id`, `payee_commitment`, `amount_commitment`, `adapter_id`, `deadline`, `circuit_artifact_hash`, `sender_pkh`, `operator_pkh`, `oracle_public_key` — all field lengths validated on-chain.

Cardano observers see only commitments + the hashed adapter id + signer PKHs. The payee handle, fiat amount, and rail-quote details remain off-chain (this privacy property carries over to v2 unchanged).

## Midnight side — v1 local run (historical; placeholder-anchored)

The Midnight Compact contract `contract/src/offramp.compact` was compiled (`compact compile`, version `0.5.1`) and exercised on a **local** Midnight devnet (network id: `undeployed` — `midnightntwrk/midnight-node:0.22.1` + `indexer-standalone:4.0.0` + `proof-server:8.0.3`). The circuits below produced real SNARK proofs accepted by the local node, **but the run was placeholder-anchored**: the circuit inputs were not bound to any real Cardano lock transaction, so this run does not evidence Cardano↔Midnight integration. (In v2, `bindOffRampIntent` anchors the real lock tx hash and receipts carry finalized tx/block identifiers — see [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0).)

| Step | txId | txHash | Block |
|------|------|--------|-------|
| **Deploy** (constructor) | `00c6e14b3805db63fed539dfdfe76c0aceb7eedd4571f9a71153c262937d329b47` | `bb81cf195bf622bf4d6caf472c50463a964ab5569a37ff2d698fa0da79a6e9f2` | 15768 |
| **bindOffRampIntent** (public; placeholder anchor) | `001b750f4497897824e879460535c88ab44a68a517a75f07535c22c3d82d4a0429` | `0af60aa5f5a5dab22a9329e7ecd999fe4564a96ad3f10f3ee95c78feb3f806e3` | 15771 |
| **provePayeeBinding** (zk-SNARK) | `00f896a189e0daecb1f7e26bb75b48a40a9b7ea532b93b98af471e5e7d897641d5` | `895035987cc42bb73dd702d99fb03be614bee50f8f2088781b35e28d862fc56d` | 15774 |
| **proveAmountBinding** (zk-SNARK) | `00cf09747f25df09b63a0e66e9b059900032ae0eb049ece7ccbba5e658992cab6c` | `a04db05bdebf8b045abc742c85b0fd6813cdf8d6cfad33df419a2153aad9f622` | 15777 |
| **proveComplianceFlag** (zk-SNARK) | `00353a15fc38f20cda9c7cb63532e61053d3ab0063686d4d4189ebf7ee8d25ab15` | `22a309add3ebd6a0834a58d3f0fd52fed0b715350a9ce218c11a82e46d29ce12` | 15780 |
| **proveOffRampSettlement** (zk-SNARK) | `00f5a7c5cf6b3499f5794c73acc557037c98e8fcdf9602af234e40f0d664cc8285` | `f86e2ffb28c41b3e226bcb70de95c1966d25a2e415f4776d4a41979e76248995` | 15784 |

**Midnight contract address (local devnet):** `a3a72a55eb37317300a6c0718578a8e82040dacce3f139e23e1f52af99f77030`

> **Correction to the v1.0.0 text:** the v1 SDK's off-chain `prove()` did **not** share "identical proving semantics" with the compiled circuits — it produced SHA-256 digests, not SNARK proofs. The v2 SDK removed that path entirely: proving goes through the required `MidnightProofProvider` (real proof server) or fails closed.

## Current (v2.0.0) evidence

- Aiken validator: **25/25** (`npm run cardano:check`)
- Lucid emulator on-chain suite: **17/17** ([`sdk/test/escrow-emulator.test.mjs`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/test/escrow-emulator.test.mjs))
- End-to-end Preprod + Midnight + Revolut-sandbox run and deadline-gated refund run: [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0) (`e2e-run-1.*`, `e2e-refund-1.*`)
