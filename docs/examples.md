# Examples

Three runnable end-to-end scenarios. Each one is grounded in a script that ships in the repo.

## Example 1 — Cash App LOCK → simulated settlement → RELEASE

Lifecycle: **Initiate → LOCK (Preprod) → Prove → Submit (mock) → Settle → RELEASE (Preprod)**.

Run via:

```bash
# 1. Real LOCK on Preprod
npm run preprod:lock -- cashapp '$alice' 1.50 USD
# prints lockTxHash + Cardanoscan link

# 2. RELEASE (operator-signed)
npm run preprod:release -- <lockTxHash>
```

Source: [`scripts/preprod-lock.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/preprod-lock.ts) + [`scripts/preprod-release.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/preprod-release.ts).

Programmatic equivalent (no shell):

```ts
const lucid = await createAppLucid("sender");
const senderPkh   = paymentPkhFromAddress(await lucid.wallet().address());
const operatorPkh = senderPkh; // single-seed demo

const sdk = new OffRampSDK({ senderPkh, operatorPkh });
const { initiate, payeeSalt, amountSalt, railQuote } = await sdk.initiateOffRamp({
  adapter: "cashapp", payeeHandle: "$alice",
  amountAda: 2, fiatAmount: "1.50", fiatCurrency: "USD",
});

const { txHash: lockTxHash } = await submitLockTx({ lucid, intentRecord: /* ... */ });

const proof = await sdk.generateZKProof({
  intentId: initiate.intentId, payeeHandle: "$alice", payeeSalt,
  fiatAmount: "1.50", fiatCurrency: "USD",
  railQuoteDigest: railQuote.railQuoteDigest,
  principalLovelace: initiate.escrowLovelace, amountSalt,
  adapterTag: initiate.adapterTag,
});

const submit = await sdk.submitPayment({
  adapter: "cashapp", intentId: initiate.intentId, proof,
  payeeHandle: "$alice", quote: railQuote,
});

const att = await sdk.confirmSettlement({
  intentId: initiate.intentId, railTxRef: submit.railTxRef,
  status: "SETTLED", webhookHmac: submit.webhookHmac,
});

const { txHash: releaseTxHash } = await submitReleaseTx({
  lucid, intentId: initiate.intentId, lockTxHash, lockOutputIndex: 0,
});
```

Real Preprod evidence for the LOCK + RELEASE pair is in [`testnet-evidence.md`](testnet-evidence.md) — e.g. LOCK `b55e48084290…64ac2` and RELEASE `c84c242d6f86…d3168`.

## Example 2 — Wise live-sandbox transfer

Lifecycle: **Initiate → Prove → Submit (Wise sandbox) → Settle**.

```bash
export RAIL_ADAPTER_MODE=sandbox
export WISE_API_TOKEN=<your-personal-sandbox-token>
npm run test:internal       # or call submitPayment("wise") from a custom script
```

Captured 6-step run is in [`sandbox-evidence/README.md`](sandbox-evidence/README.md):

1. `GET /v1/profiles` (200)
2. `POST /v3/profiles/{id}/quotes` (200)
3. `POST /v1/accounts` (200) — recipient
4. `POST /v1/transfers` (200) — Wise transfer `2147582543` created
5. `POST /v3/profiles/{id}/transfers/{tid}/payments` (403 SCA-gated)
6. `GET /v1/transfers/{tid}` (200) — status `incoming_payment_waiting`

The SDK's responsibility ends at submitting the funding intent; provider-side SCA completes the funding.

## Example 3 — Refund after the deadline

Lifecycle: **Initiate → LOCK (Preprod) → wait for `deadline` → REFUND (Preprod, sender-signed)**.

```bash
# 1. Real LOCK on Preprod
npm run preprod:lock -- wise '$bob' 1.50 USD

# 2. Wait for ESCROW_DEADLINE_SECONDS (default 900s) to elapse, then:
npm run preprod:refund -- <lockTxHash>
```

Source: [`scripts/preprod-refund.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/scripts/preprod-refund.ts).

Real Preprod evidence: LOCK `f26f023dfc80…c6c3` → REFUND `a8c50ba93412…d0b9` ([`testnet-evidence.md`](testnet-evidence.md)).

## Running the internal test suite

```bash
npm run test:internal       # 10 × cashapp / wise / revolut = 30 simulated off-ramps
```

Writes [`internal-testing-report.md`](internal-testing-report.md) + `data/testing-report.json` (gitignored). Latest committed run: **30/30 successes, avg prove 751 ms** ([final-testing-and-release.md](final-testing-and-release.md)).
