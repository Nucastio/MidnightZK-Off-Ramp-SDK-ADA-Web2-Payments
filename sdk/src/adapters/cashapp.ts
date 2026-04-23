import type { RailAdapter, SubmitPaymentInput } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";

/**
 * Cash App (Afterpay) sandbox adapter.
 * - mock mode: deterministic responses + signed webhook events
 * - sandbox mode (when real creds are set): would POST to Cash App Afterpay
 *   sandbox base URL using the configured client credentials
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
