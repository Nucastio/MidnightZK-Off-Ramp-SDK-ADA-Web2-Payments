import type { RailAdapter, SubmitPaymentInput } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";

/**
 * Revolut Business sandbox adapter.
 * - mock mode: deterministic responses + regional availability stub
 * - sandbox mode: would POST to https://sandbox-b2b.revolut.com using OAuth
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
