import type { RailAdapter, SubmitPaymentInput } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";

/**
 * Revolut Business rail adapter.
 *
 * Mode is selected by `RAIL_ADAPTER_MODE`:
 *
 *   - `mock` (default): deterministic responses + regional availability stub
 *                       via `mock.ts`. No outbound HTTP.
 *
 *   - `sandbox`: would POST to https://sandbox-b2b.revolut.com using the
 *                JWT-signed OAuth client-credentials flow. Revolut requires
 *                uploading an X.509 public cert + JWT-issuer config before a
 *                client_id is issued; until that onboarding is complete this
 *                adapter falls back to mock. See `sdk/src/adapters/wise.ts`
 *                for the live-sandbox pattern that this adapter ports when
 *                Revolut credentials are available.
 */
export const revolutAdapter: RailAdapter = {
  id: "revolut",
  async quote(input) {
    return buildQuote("revolut", input);
  },
  async submit(input: SubmitPaymentInput) {
    return adapterSubmit("revolut", input);
  },
  async emitWebhook(intentId, status) {
    return buildWebhook({ intentId, status, adapter: "revolut", railTxRef: buildRailTxRef("revolut") });
  },
};
