# Examples

Runnable end-to-end scenarios, each grounded in a script that ships in the repo.

## Example 1 — Full happy-path E2E (Preprod + Midnight + Revolut sandbox)

Lifecycle: **Initiate → LOCK (Preprod) → Midnight intent receipt → Revolut sandbox payout → adapter-observed settlement → Midnight settlement receipt → oracle-signed release authorization → RELEASE (Preprod)**.

```bash
npx tsx scripts/e2e-preprod.ts
# evidence → docs/evidence/v2.0.0/e2e-run-1.json + e2e-run-1.md
```

Source: [`scripts/e2e-preprod.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/e2e-preprod.ts). The script uses no mocks: real Blockfrost Preprod transactions, the real Midnight proof provider (node + indexer + proof server), and the live Revolut sandbox via the SDK adapter, capturing machine-readable evidence at every stage (and the verbatim failing error if a stage fails).

Programmatic sketch (see the [integration guide](integration.md) for the full, explained version):

```ts
const midnightProofProvider = createMidnightProofProviderFromEnv();
const sdk = new OffRampSDK({ senderPkh, operatorPkh, midnightProofProvider });

const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
  adapter: "revolut", payeeHandle: "revolut-counterparty",
  amountAda: 5, fiatAmount: "1.50", fiatCurrency: "GBP",
});

const { txHash: lockTxHash } = await submitLockTx(lucidSender, datum, initiate.escrowLovelace);

const proof = await sdk.generateZKProof({
  intentId: initiate.intentId,
  cardanoLockAnchor: { txHash: lockTxHash, outputIndex: 0 },
  payeeHandle: "revolut-counterparty", payeeSalt,
  fiatAmount: "1.50", fiatCurrency: "GBP",
  railQuoteDigest: railQuote.railQuoteDigest,
  principalLovelace: initiate.escrowLovelace, amountSalt,
  payeeCommitment: initiate.payeeCommitment,
  amountCommitment: initiate.amountCommitment,
  adapterTag: initiate.adapterTag,
});

const submit = await sdk.submitPayment({
  adapter: "revolut", intentId: initiate.intentId, proof,
  payeeHandle: "revolut-counterparty", quote: railQuote,
});

// poll adapter.getStatus(...) until SETTLED, then:
const att = await sdk.confirmSettlement({
  intentId: initiate.intentId, railTxRef: submit.railTxRef, status: "SETTLED",
});
const settlementReceipt = await sdk.generateSettlementReceipt({
  intentReceipt: proof, settlementDigest: att.settlementDigest,
});

const utxoRef = { txHash: lockTxHash, outputIndex: 0 };
const body = {
  settlementDigest: att.settlementDigest,
  midnightSettlementReceiptHash: settlementReceipt.receiptHash,
  authorizationExpiry: BigInt(Date.now() + 600_000),
};
const message = await releaseAuthorizationMessageForUtxo(lucidOperator, utxoRef, body);
const { txHash: releaseTxHash } = await submitReleaseTx(lucidOperator, utxoRef, {
  ...body, oracleSignature: signReleaseAuthorization(message),
});
```

## Example 2 — Deadline-gated refund

Lifecycle: **Initiate → LOCK (Preprod) → wait for `deadline` → REFUND (Preprod, sender-signed)**.

```bash
# Standalone scripts:
npm run preprod:lock -- wise '$bob' 1.50 USD
npm run preprod:refund -- <lockTxHash>     # on-chain valid only at/after the deadline

# Or the evidence-capturing E2E driver:
npx tsx scripts/e2e-preprod-refund.ts
# evidence → docs/evidence/v2.0.0/e2e-refund-1.json + e2e-refund-1.md
```

Source: [`scripts/preprod-refund.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/preprod-refund.ts) + [`scripts/e2e-preprod-refund.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/e2e-preprod-refund.ts). The validator rejects a refund whose validity window starts before the datum deadline, so `submitRefundTx` sets `validFrom = max(now, deadline)` — a premature refund cannot enter the chain.

There is deliberately **no** standalone release npm script: releasing requires stored settlement evidence + an oracle-signed UTxO-bound authorization, which the E2E driver produces (Example 1).

## Example 3 — Emulator suite (no network needed)

The complete on-chain surface — valid release, tampered digests/signatures, replay on a different UTxO, wrong signers, premature refunds, full-value checks — runs against an in-process Lucid emulator:

```bash
npm test -w @nucast/midnightzk-offramp-sdk    # includes escrow-emulator.test.mjs — 17/17
```

Source: [`sdk/test/escrow-emulator.test.mjs`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/test/escrow-emulator.test.mjs). The same negative-path matrix exists at the validator level in Aiken: `npm run cardano:check` (25/25).

## Simulation harness (not provider evidence)

```bash
npm run test:internal       # 10 × cashapp / wise / revolut = 30 SIMULATED off-ramps
```

Runs the pipeline against the **deterministic mock adapters** (`RAIL_ADAPTER_MODE=mock`) and writes [`internal-testing-report.md`](internal-testing-report.md) + `data/testing-report.json`. Useful as a smoke test of the wiring; its success rates and latency figures describe the simulation harness only and are **not** evidence of live rail integration.

## Historical v1.0.0 evidence (superseded)

Earlier revisions of this page cited v1.0.0 Preprod transactions (e.g. LOCK `f26f023d…` → REFUND `a8c50ba9…`, LOCK `b55e4808…` → RELEASE `c84c242d…`). Those ran against the **old signature-only validator** — the release required nothing beyond an operator signature, and the refund succeeded **without any deadline enforcement** (which is precisely the gap the v2 validator closes). They are retained, with caveats, in [`testnet-evidence.md`](testnet-evidence.md).
