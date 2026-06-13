# SDK Reference

TypeScript surface published by [`sdk/src/index.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/index.ts).

```ts
import {
  OffRampSDK,
  // Cardano
  createAppLucid, addressPaymentPkh,
  escrowScript, escrowScriptAddress, escrowDatumCbor, paymentPkhFromAddress,
  RELEASE_REDEEMER, REFUND_REDEEMER,
  submitLockTx, submitReleaseTx, submitRefundTx,
  // Adapters
  adapters, getAdapter, cashappAdapter, wiseAdapter, revolutAdapter,
  // Midnight
  prove, verify,
  // Oracle
  attestSettlement, verifyAttestation, verifyAdapterWebhook, operatorPublicKeyHex,
  // Commitments
  payeeCommitment, amountCommitment, intentId, adapterTag, vkHash,
  circuitId, randomNonce, settlementDigest, railQuoteDigest, sha256Hex,
} from "./sdk/src/index.ts";
```

## `OffRampSDK`

```ts
class OffRampSDK {
  constructor(cfg: { senderPkh: string; operatorPkh: string;
                     escrowLovelace?: bigint; deadlineSeconds?: number });

  initiateOffRamp(p: IntentParams)
      : Promise<{ initiate: InitiateOffRampResult; payeeSalt: string;
                  amountSalt: string; railQuote: RailQuote }>;

  generateZKProof(input: {
    intentId: string; payeeHandle: string; payeeSalt: string;
    fiatAmount: string; fiatCurrency: Currency; railQuoteDigest: string;
    principalLovelace: bigint; amountSalt: string; adapterTag: string;
    complianceMask?: string;
  }): Promise<ProofBundle>;

  verifyZKProof(proof: ProofBundle, inputs: { ... })
      : Promise<{ ok: true; verifyDurationMs: number }>;     // throws on mismatch

  submitPayment(input: {
    adapter: RailId; intentId: string; proof: ProofBundle;
    payeeHandle: string; quote: RailQuote;
  }): Promise<SubmitPaymentResult>;

  confirmSettlement(input: {
    intentId: string; railTxRef: string; status: "SETTLED" | "FAILED";
    webhookPayload?: Record<string, unknown>; webhookHmac?: string;
  }): Promise<OracleAttestation>;

  listAdapters(): RailAdapter[];
}
```

See the [integration guide](integration.md) for end-to-end usage.

## Cardano helpers

```ts
createAppLucid(role: "sender" | "operator"): Promise<Lucid>;        // Lucid Evolution bound to env mnemonic
addressPaymentPkh(addr: string): string;
paymentPkhFromAddress(addr: string): string;
escrowScript(): Script;                                              // Aiken-compiled PlutusV3 validator
escrowScriptAddress(network?: "Preprod" | "Mainnet"): string;
escrowDatumCbor(record: IntentRecord): string;
RELEASE_REDEEMER: string;
REFUND_REDEEMER: string;

submitLockTx(args:    { lucid: Lucid; intentRecord: IntentRecord }): Promise<{ txHash: string }>;
submitReleaseTx(args: { lucid: Lucid; intentId: string;
                        lockTxHash: string; lockOutputIndex: number }): Promise<{ txHash: string }>;
submitRefundTx(args:  { lucid: Lucid; intentId: string;
                        lockTxHash: string; lockOutputIndex: number }): Promise<{ txHash: string }>;
```

Source: [`sdk/src/cardano/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/cardano).

## Rail adapters

```ts
type RailId = "cashapp" | "wise" | "revolut";

interface RailAdapter {
  readonly id: RailId;
  quote(input: { fiatAmount: string; fiatCurrency: Currency }): Promise<RailQuote>;
  submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult>;   // idempotent on intentId
}

const adapters: { cashapp: RailAdapter; wise: RailAdapter; revolut: RailAdapter };
function getAdapter(id: RailId): RailAdapter;
```

Mode is selected by `RAIL_ADAPTER_MODE=mock|sandbox`. The Wise sandbox is fully wired ([live evidence](sandbox-evidence/README.md)). Cash App uses Afterpay sandbox semantics — provider docs: <https://www.postman.com/afterpay-1-426879/afterpay-online-apis-v2/folder/zohg5nd/checkouts>. Revolut sandbox follows the same `RailAdapter` interface and is ready for credentials.

Source: [`sdk/src/adapters/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/adapters).

## Midnight prover

```ts
function prove(input):  Promise<ProofBundle>;
function verify(proof, inputs): Promise<{ ok: true; verifyDurationMs: number }
                                       | { ok: false; reason: string; verifyDurationMs: number }>;
```

`prove` re-derives the commitments from witnesses, sleeps a target proving window (≤ NFR-2's 50 s budget), and emits a 32-byte digest binding witnesses + public inputs + `vkHash`. Source: [`sdk/src/midnight/prove.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/midnight/prove.ts).

## Settlement Oracle

```ts
function attestSettlement(in: { intentId; railTxRef; status }): OracleAttestation;
function verifyAttestation(att: OracleAttestation): boolean;
function verifyAdapterWebhook(payload, hmac): boolean;
function operatorPublicKeyHex(): string;
```

Source: [`sdk/src/oracle/settlement-oracle.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/oracle/settlement-oracle.ts). The operator's Ed25519 secret comes from `OPERATOR_ED25519_SK_HEX`. Publish only the public key (`operatorPublicKeyHex()`) to consumers.

## Commitment helpers

```ts
payeeCommitment(handle, salt): { commitment: string };               // 64-hex
amountCommitment({ fiatAmount, fiatCurrency, railQuoteDigest,
                   principalLovelace, salt }): { commitment: string };
intentId({ adapter, senderPkh, payeeCommitment, amountCommitment, createdAt }): string;
adapterTag(adapter: RailId): string;
vkHash(): string;                                                    // pinned circuit verification key id
circuitId(): string;                                                 // "offramp:v1"
randomNonce(byteLen: number): string;                                // hex
settlementDigest({ intentId, railTxRef, status }): string;
railQuoteDigest({ adapter, fiatAmount, fiatCurrency, quotedAt, ... }): string;
sha256Hex(bytes: Uint8Array): string;
```

Source: [`sdk/src/commitments.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/commitments.ts).

## Errors

```ts
class OracleError extends Error {}
class ProofVerifyError extends Error {}
class RailError extends Error { rail: RailId; }
```

`submitPayment` throws `RailError` if the adapter rejects; `verifyZKProof` throws `ProofVerifyError`; `confirmSettlement` throws `OracleError` on HMAC mismatch or self-verify failure.

## Types

The full type definitions (`IntentParams`, `InitiateOffRampResult`, `ProofBundle`, `RailQuote`, `SubmitPaymentResult`, `OracleAttestation`, …) live in [`sdk/src/types.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/types.ts).
