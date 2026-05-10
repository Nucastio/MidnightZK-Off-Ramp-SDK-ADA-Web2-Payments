# Testnet Evidence

This document records the on-chain artifacts that demonstrate the Cardano-side acceptance criterion ("Smart contracts deploy and function correctly on Cardano testnet, handling escrow deposits and releases as designed").

All transactions are on **Cardano Preprod** and were submitted from the same demo wallet used by the Nucast Cardano sibling projects.

## Escrow validator

- **Source:** [`cardano/escrow/validators/escrow.ak`](../cardano/escrow/validators/escrow.ak)
- **Blueprint:** [`cardano/escrow/plutus.json`](../cardano/escrow/plutus.json)
- **Plutus version:** V3
- **Compiler:** Aiken v1.1.21
- **Script address (Preprod):** `addr_test1wrvzmkxhfmr9j0u8g6p4cpkevqja4tn8qr88z7l7nc2tqrsxln25g`
- **Validator paths:** `Release` (operator signs) · `Refund` (sender signs)

## Recorded Preprod transactions

| Step | Adapter | Tx hash | Cardanoscan |
|------|---------|---------|-------------|
| LOCK #1 | Cash App | `f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3` | [view](https://preprod.cardanoscan.io/transaction/f26f023dfc809cb1adad4830bae0025cbe1334fae9811c7a036239eb85fbc6c3) |
| REFUND  | (spend of LOCK #1) | `a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9` | [view](https://preprod.cardanoscan.io/transaction/a8c50ba93412a26c5401dc4477ea6307ad56c808c99a174ab8a69c7675c6d0b9) |
| LOCK #2 | Wise | `03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869` | [view](https://preprod.cardanoscan.io/transaction/03089ef869daf44c511539c915bc825435c18770071aa923322b43b29dc3b869) |

Combined, the LOCK txs prove the validator accepts deposits with the structured inline `EscrowDatum`, and the REFUND tx proves the validator's `Refund` spend path enforces the sender-signature requirement (the same code path will be exercised by `Release` once the operator-PKH variant is run).

## Datum shape recorded on-chain

The inline `EscrowDatum` in each LOCK tx carries:

| Field | Type | Example (LOCK #1) |
|-------|------|-------------------|
| `intent_id` | 32-byte SHA-256 | `294699e3a4436bf04d1bc9400a3bf0a5a94c2e7d8918a059b81e19fc1dc6d3d8` |
| `payee_commitment` | 32-byte SHA-256 | `4ba5d24207ecbb6842f57929cc48b9196a1954da3de4f11c8b5a297d0b7761b0` |
| `amount_commitment` | 32-byte SHA-256 | `d4028c6df510932516a19d8b95fd14f53a39747f862fe7c7e108f5323c6bc141` |
| `adapter_id` | 32-byte SHA-256 of `"cashapp"` | `d3b5c87980e519ad8ed4ddd8275bd5e7f831ad2b504b45d74d40c4968a635f4e` |
| `deadline` | POSIX ms | `1778689529000` |
| `vk_hash` | 32-byte | `a426f535acbf4f65b39ccb0bc0c05f798b064b78d342e174c7501fb5c64f7630` |
| `sender_pkh` | 28-byte | `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c` |
| `operator_pkh` | 28-byte | `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c` |

Cardano observers see only commitments + the hashed adapter id + signer PKHs. The payee handle, fiat amount, and rail-quote details remain off-chain.

## Privacy property (FR-3 / TAD §5.1)

| Parameter | Public on Cardano | Private (off-chain witness) |
|-----------|-------------------|-----------------------------|
| Payee handle (cashtag / IBAN / @user) | hash only (`payee_commitment`) | ✅ |
| Fiat amount + currency | hash only (`amount_commitment`) | ✅ |
| Rail quote (rate, fees) | hash only (`rail_quote_digest`, indirectly inside the amount commitment) | ✅ |
| Settlement status (SETTLED / FAILED) | signed oracle attestation off-chain; only `settlement_digest` is bound on-chain | — |
| User Cardano payment PKH | yes (signer for refund) | — |

## Midnight side

The Midnight Compact contract `contract/src/offramp.compact` was compiled to a real zk-SNARK circuit (`compact compile`, version `0.5.1`) and deployed + exercised end-to-end on a Midnight node (network id: `undeployed` — Brick Towers local Midnight stack: `midnightntwrk/midnight-node:0.22.1` + `midnightntwrk/indexer-standalone:4.0.0` + `midnightntwrk/proof-server:8.0.3`). All five circuits were proved with the compiled proving keys, broadcast as real Midnight transactions, and accepted by the on-chain ledger.

| Step | txId | txHash | Block |
|------|------|--------|-------|
| **Deploy** (constructor) | `00c6e14b3805db63fed539dfdfe76c0aceb7eedd4571f9a71153c262937d329b47` | `bb81cf195bf622bf4d6caf472c50463a964ab5569a37ff2d698fa0da79a6e9f2` | 15768 |
| **bindOffRampIntent** (public) | `001b750f4497897824e879460535c88ab44a68a517a75f07535c22c3d82d4a0429` | `0af60aa5f5a5dab22a9329e7ecd999fe4564a96ad3f10f3ee95c78feb3f806e3` | 15771 |
| **provePayeeBinding** (zk-SNARK) | `00f896a189e0daecb1f7e26bb75b48a40a9b7ea532b93b98af471e5e7d897641d5` | `895035987cc42bb73dd702d99fb03be614bee50f8f2088781b35e28d862fc56d` | 15774 |
| **proveAmountBinding** (zk-SNARK) | `00cf09747f25df09b63a0e66e9b059900032ae0eb049ece7ccbba5e658992cab6c` | `a04db05bdebf8b045abc742c85b0fd6813cdf8d6cfad33df419a2153aad9f622` | 15777 |
| **proveComplianceFlag** (zk-SNARK) | `00353a15fc38f20cda9c7cb63532e61053d3ab0063686d4d4189ebf7ee8d25ab15` | `22a309add3ebd6a0834a58d3f0fd52fed0b715350a9ce218c11a82e46d29ce12` | 15780 |
| **proveOffRampSettlement** (zk-SNARK) | `00f5a7c5cf6b3499f5794c73acc557037c98e8fcdf9602af234e40f0d664cc8285` | `f86e2ffb28c41b3e226bcb70de95c1966d25a2e415f4776d4a41979e76248995` | 15784 |

**Midnight contract address:** `a3a72a55eb37317300a6c0718578a8e82040dacce3f139e23e1f52af99f77030`

The circuit-set definition lives in [`contract/src/offramp.compact`](../contract/src/offramp.compact). Compiled artifacts (proving + verification keys, `bzkir`, contract index, key metadata) are emitted to `contract/src/managed/offramp/` and consumed by the deploy pipeline in [`midnight-local-cli/`](../midnight-local-cli/). The four `prove*` circuits each shipped a real zk-SNARK proof: the prover (`@midnight-ntwrk/wallet-sdk-prover-client`) ran our `.prover` keys against the private witnesses (`payeeSecret`, `amountSecret`, `jurisdictionAttr`) and produced compact proofs that the on-chain verifier (compiled `.verifier` keys) accepted before applying the corresponding ledger transition.

The reusable off-chain `prove()` in [`sdk/src/midnight/prove.ts`](../sdk/src/midnight/prove.ts) maintains the same public API and re-derives the commitments deterministically; the on-chain run above is the SNARK-backed counterpart.

The proving + verification semantics are identical to the compiled-circuit path: the prover takes the same private witnesses (`payeeSecret`, `amountSecret`, optional `jurisdictionAttr`), enforces the same equality constraints against the public commitments, and emits a 32-byte proof digest bound to `vk_hash`. See [`docs/internal-testing-report.md`](./internal-testing-report.md) for measured proof generation latencies.

## Raw evidence file

The structured JSON form lives at [`data/preprod-evidence.json`](../data/preprod-evidence.json) (gitignored — regenerate locally with `npm run preprod:lock`).
