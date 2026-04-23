import type { RailAdapter, SubmitPaymentInput } from "../types.ts";
import { adapterSubmit, buildQuote, buildRailTxRef, buildWebhook } from "./mock.ts";

/**
 * Wise (TransferWise) sandbox adapter.
 * - mock mode: pre-funded sandbox semantics, deterministic responses
 * - sandbox mode: would POST to https://api.sandbox.transferwise.tech using
 *   a personal sandbox API token
 */
export const wiseAdapter: RailAdapter = {
  id: "wise",
  async quote(input) {
    return buildQuote("wise", input);
  },
  async submit(input: SubmitPaymentInput) {
    return adapterSubmit("wise", input);
  },
  async emitWebhook(intentId, status) {
    return buildWebhook({ intentId, status, adapter: "wise", railTxRef: buildRailTxRef("wise") });
  },
};
