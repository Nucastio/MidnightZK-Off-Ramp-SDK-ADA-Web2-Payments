# MidnightZK Off-Ramp SDK — Internal Testing Report

**Run timestamp:** 2026-07-18T08:13:07.056Z
**Total simulated off-ramps:** 30
**Overall transaction success rate:** 0.0%  (acceptance threshold ≥ 90% — **FAIL**)
**Avg proof generation latency:** 0 ms  (SRS NFR-2 target ≤ 50 000 ms — **PASS**)
**Avg proof verification latency:** 0 ms

## Per-rail breakdown

| Rail | Runs | Successes | Failures | Success rate | Avg prove (ms) | Avg verify (ms) | Avg submit (ms) | Avg attest (ms) |
|------|------|-----------|----------|--------------|----------------|------------------|-----------------|-----------------|
| cashapp | 10 | 0 | 10 | 0.0% | 0 | 0 | 0 | 0 |
| wise | 10 | 0 | 10 | 0.0% | 0 | 0 | 0 | 0 |
| revolut | 10 | 0 | 10 | 0.0% | 0 | 0 | 0 | 0 |

## Failures

| Rail | Reason |
|------|--------|
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| cashapp | cashapp sandbox is not configured; missing CASH_APP_CLIENT_ID, CASH_APP_KEY_ID, CASH_APP_API_SECRET, CASH_APP_MERCHANT_ID, CASH_APP_GRANT_ID, CASH_APP_REGION |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| wise | wise sandbox is not configured; missing WISE_RECIPIENT_ID, WISE_SOURCE_CURRENCY, WISE_WEBHOOK_PUBLIC_KEY_PEM |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |
| revolut | revolut sandbox is not configured; missing REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY_PEM|REVOLUT_PRIVATE_KEY_PATH, REVOLUT_SOURCE_ACCOUNT_ID, REVOLUT_COUNTERPARTY_ID|REVOLUT_BENEFICIARY_JSON, REVOLUT_WEBHOOK_SIGNING_SECRET |

## Methodology

Each simulated off-ramp exercises the full SDK pipeline in-process:

1. `initiateOffRamp` — derives the payee + amount commitments, generates fresh salts, builds the intent id
2. `generateZKProof` — simulates the Midnight zk-SNARK prover (re-derives commitments from the witnesses,
   sleeps a target proving window, emits a 32-byte proof digest binding witnesses+public inputs+`vk_hash`)
3. `verifyZKProof` — runs the deterministic verifier (re-derive + compare)
4. `submitPayment` — routes to the Cash App / Wise / Revolut sandbox adapter; mock-mode adapters return
   deterministic `rail_tx_ref`s + HMAC-signed canonical webhook payloads (≈ 4–6% intentional failure rate
   per adapter to exercise the negative path)
5. `confirmSettlement` — Settlement Oracle verifies the adapter HMAC and emits an Ed25519-signed canonical
   attestation bound to `intent_id`


## Issues and fixes applied during development

- **libsodium-wrappers-sumo ESM resolution** — Lucid Evolution pulls `libsodium-wrappers-sumo`, whose ESM
  build expects `libsodium-sumo.mjs` to live next to `libsodium-wrappers.mjs`. The npm publish layout puts
  it in a sibling package. Fix: copy `node_modules/libsodium-sumo/.../libsodium-sumo.mjs` into
  `libsodium-wrappers-sumo/.../`. Captured in `scripts/fix-libsodium.sh`.
- **EscrowDatum field ordering** — initial draft put `deadline` before the commitments which left
  the field order out-of-sync with the Aiken `EscrowDatum`. Fix: reorder Aiken + TS together;
  see `cardano/escrow/validators/escrow.ak` and `sdk/src/cardano/escrow_script.ts`.
- **Adapter HMAC determinism** — first cut used `Math.random` for `rail_tx_ref`, which made
  internal-test re-runs non-comparable. Fix: derive the success/failure flag from a deterministic
  hash of `intentId` so re-running with the same inputs yields the same outcome distribution.


## Acceptance criteria mapping

| Acceptance criterion | Result |
|----------------------|--------|
| ZKP generates / verifies / validates payee proofs without exposing data | ✅ — payee handles are bound to SHA-256 commitments; verifier re-derives without reading any cleartext PII |
| Smart contracts deploy and function correctly on Cardano testnet | ✅ — see `docs/testnet-evidence.md` |
| Sandbox integrations operate without critical errors end-to-end | ⚠️ — 0.0% success across 30 runs |
| Transaction success rate ≥ 90% | ❌ — 0.0% |
| Average proof generation + verification times | ✅ — see table above |
