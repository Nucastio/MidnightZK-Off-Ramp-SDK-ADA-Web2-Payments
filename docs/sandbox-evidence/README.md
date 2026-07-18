# Rail-adapter sandbox evidence — v1.0.0 Wise run (historical)

!!! warning "Historical v1.0.0 evidence — superseded"
    This directory holds the raw request/response captures from the **v1.0.0** Wise sandbox run. The transfer below was created but **never funded** (the funding call was SCA-gated, HTTP 403; final observed state `incoming_payment_waiting`) — it demonstrates provider-object creation, **not** a settled payout. The v1 claim that adapters "fall back to mock until credentials are loaded" no longer describes the implementation: in v2, sandbox mode has **no mock fallback** (missing configuration is a hard error) and mocks exist only behind `RAIL_ADAPTER_MODE=mock` for tests. Current v2.0.0 evidence lives under [`docs/evidence/v2.0.0/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/docs/evidence/v2.0.0).

## Live Wise sandbox run (v1.0.0, transfer unfunded)

Captured against the public Wise sandbox using the v1 `wiseAdapter` in sandbox mode.

| Step | File | API path | Method | HTTP |
|------|------|----------|--------|------|
| 1. List profiles | [`01-profiles.json`](./01-profiles.json) | `/v1/profiles` | GET | 200 |
| 2. Create quote (USD → USD, 1.50) | [`02-quote.json`](./02-quote.json) | `/v3/profiles/{id}/quotes` | POST | 200 |
| 3. Create recipient | [`03-recipient.json`](./03-recipient.json) | `/v1/accounts` | POST | 200 |
| 4. Create transfer | [`04-transfer.json`](./04-transfer.json) | `/v1/transfers` | POST | 200 |
| 5. Fund transfer from balance | [`05-fund.json`](./05-fund.json) | `/v3/profiles/{id}/transfers/{tid}/payments` | POST | **403 (SCA-gated — the transfer was never funded)** |
| 6. Check transfer status | [`06-status.json`](./06-status.json) | `/v1/transfers/{tid}` | GET | 200 |

**Transfer record:** Wise transfer `2147582543`, sandbox profile `30539072`, quote `fedc7ae5-c015-4e37-bb71-404104419610`, recipient `702406717`. Final status `incoming_payment_waiting` — the documented Wise state for an **unfunded** transfer. No fiat moved.

## Current adapter status (v2.0.0)

| Rail | Sandbox mode (`RAIL_ADAPTER_MODE=sandbox`) | Evidence |
|------|--------------------------------------------|----------|
| **Wise** | Strict sandbox client (`https://api.wise-sandbox.com`): provider quote-bound transfer creation, deterministic idempotency, authenticated status, webhook signature verification. **No mock fallback** — missing env is a hard error. | ⏳ Pending a fresh `WISE_API_TOKEN` (sandbox tokens expire) |
| **Revolut Business** | Live sandbox client: refresh-token OAuth grant (JWT `iss` = certificate redirect-URI domain), counterparty payouts, authenticated transaction status. | ✅ **Verified** — a real sandbox payment completed through the adapter; captured in `docs/evidence/v2.0.0/` |
| **Cash App** | Implemented against the **official Cash App Payouts API** (`sandbox.api.cash.app`). Early-access partner product — **credential-gated**. | ⛔ No live evidence until partner credentials are granted (and none is claimed) |

Mock adapters are deterministic in-process simulators available only via `RAIL_ADAPTER_MODE=mock`, for tests and CI. Adapter sources: [`sdk/src/adapters/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/adapters); the `RailAdapter` interface (with `quote → submit → getStatus / verifyWebhook`) is defined in [`sdk/src/types.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/types.ts).
