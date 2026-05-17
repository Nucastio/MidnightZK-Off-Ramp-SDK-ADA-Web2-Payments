import type { RailAdapter, SubmitPaymentInput } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";

/**
 * Cash App (Afterpay) rail adapter.
 *
 * Mode is selected by `RAIL_ADAPTER_MODE`:
 *
 *   - `mock` (default): deterministic responses + HMAC-signed webhook payloads
 *                       via `mock.ts`. No outbound HTTP. Used by CI and the
 *                       internal test harness so runs stay reproducible.
 *
 *   - `sandbox`: would POST to the Cash App Afterpay sandbox base URL using
 *                merchant-onboarded client credentials. Cash App / Afterpay
 *                sandbox access requires manual onboarding through a delivery
 *                manager and is therefore NOT auto-enabled; this adapter falls
 *                back to mock unless real credentials + a feature flag are set.
 *                See `sdk/src/adapters/wise.ts` for the live-sandbox pattern
 *                ported when Cash App credentials are available.
 */
export const cashappAdapter: RailAdapter = {
  id: "cashapp",
  async quote(input) {
    return buildQuote("cashapp", input);
  },
  async submit(input: SubmitPaymentInput) {
    return adapterSubmit("cashapp", input);
  },
  async emitWebhook(intentId, status) {
    return buildWebhook({ intentId, status, adapter: "cashapp", railTxRef: buildRailTxRef("cashapp") });
  },
};
