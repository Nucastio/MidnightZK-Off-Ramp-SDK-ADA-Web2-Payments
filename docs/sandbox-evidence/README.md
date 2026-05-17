# Rail-adapter sandbox evidence

This directory holds raw request/response captures from real provider sandbox APIs, demonstrating that the SDK can drive live off-ramp flows when `RAIL_ADAPTER_MODE=sandbox` and provider credentials are configured.

## Live Wise sandbox run

Captured against the public Wise sandbox (`https://api.sandbox.transferwise.tech`) using the SDK's `wiseAdapter` in sandbox mode. The adapter source lives at [`sdk/src/adapters/wise.ts`](../../sdk/src/adapters/wise.ts) and is invoked by the off-ramp pipeline whenever the `wise` rail is selected with sandbox creds present.

| Step | File | API path | Method | HTTP |
|------|------|----------|--------|------|
| 1. List profiles | [`01-profiles.json`](./01-profiles.json) | `/v1/profiles` | GET | 200 |
| 2. Create quote (USD → USD, 1.50) | [`02-quote.json`](./02-quote.json) | `/v3/profiles/{id}/quotes` | POST | 200 |
| 3. Create recipient | [`03-recipient.json`](./03-recipient.json) | `/v1/accounts` | POST | 200 |
| 4. Create transfer | [`04-transfer.json`](./04-transfer.json) | `/v1/transfers` | POST | 200 |
| 5. Fund transfer from balance | [`05-fund.json`](./05-fund.json) | `/v3/profiles/{id}/transfers/{tid}/payments` | POST | 403 (SCA-gated; see note) |
| 6. Check transfer status | [`06-status.json`](./06-status.json) | `/v1/transfers/{tid}` | GET | 200 |

**Transfer record:** Wise transfer `2147582543`, sandbox profile `30539072`, quote `fedc7ae5-c015-4e37-bb71-404104419610`, recipient `702406717`. Status `incoming_payment_waiting` (the documented Wise state for an unfunded transfer).

**Step 5 note:** Wise's sandbox SCA-gates the `/payments` (fund) call on personal-API-token profiles. The transfer is real, recorded by Wise, and visible via `GET /v1/transfers/{tid}`. Funding completion requires either an OAuth-token profile or Wise SCA approval and is provider-side; the SDK's responsibility ends at submitting the funding intent.

## Reproducing the run

```bash
# 1. Sign up at https://sandbox.transferwise.tech/register (free, no KYC).
# 2. Settings -> API tokens -> Create token. Copy it.
export RAIL_ADAPTER_MODE=sandbox
export WISE_API_TOKEN=<your-personal-sandbox-token>

# 3. Drive the SDK's wise adapter end-to-end. Inspect docs/sandbox-evidence/ for fresh artefacts.
npx tsx -e '
import { wiseAdapter } from "./sdk/src/adapters/wise.ts";
const q = await wiseAdapter.quote({ fiatAmount: "1.50", fiatCurrency: "USD" });
const r = await wiseAdapter.submit({ intentId: "demo", proof: {}, payeeHandle: "Demo", quote: q });
console.log(r);
'
```

## Adapter status matrix (as committed)

| Rail | Mock mode | Sandbox mode | Onboarding required for sandbox |
|------|-----------|--------------|----------------------------------|
| **Wise** | ✅ deterministic helpers in [`mock.ts`](../../sdk/src/adapters/mock.ts) | ✅ live HTTP against `api.sandbox.transferwise.tech` (see [`wise.ts`](../../sdk/src/adapters/wise.ts) + evidence above) | Free self-service signup, ~5 min |
| **Revolut Business** | ✅ deterministic | ⏳ adapter wired to fall back to mock until credentials are loaded; live path ports the Wise pattern when X.509 cert + JWT-issuer config are completed | Self-service but requires cert upload + JWT signer (~1 hr setup) |
| **Cash App / Afterpay** | ✅ deterministic | ⏳ adapter wired to fall back to mock until credentials are loaded; live path ports the Wise pattern when delivery-manager onboarding completes | Manual delivery-manager onboarding required by vendor; not self-service |

The `RailAdapter` interface (defined in [`sdk/src/types.ts`](../../sdk/src/types.ts)) is the single integration boundary: dropping in real Cash App or Revolut credentials replaces the mock fallback with the same `quote → submit → emitWebhook` shape that the Wise adapter already exercises against live sandbox HTTP.
