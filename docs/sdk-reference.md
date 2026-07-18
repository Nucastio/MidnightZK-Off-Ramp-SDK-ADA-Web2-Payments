# SDK Reference

TypeScript surface published by [`sdk/src/index.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/index.ts).

```ts
import {
  OffRampSDK,
  // Cardano
  createAppLucid, addressPaymentPkh,
  escrowScript, escrowScriptAddress, escrowDatumCbor, decodeEscrowDatumCbor,
  releaseAuthorizationMessageCbor, releaseAuthorizationMessageForUtxo,
  releaseRedeemerCbor, paymentPkhFromAddress, paymentAddressFromPkh,
  RELEASE_REDEEMER, REFUND_REDEEMER,
  submitLockTx, submitReleaseTx, submitRefundTx,
  // Adapters
  adapters, getAdapter, adapterHealth,
  cashappAdapter, wiseAdapter, revolutAdapter,
  createCashAppAdapter, createWiseAdapter, createRevolutAdapter,
  // Midnight provider boundary + receipts
  prove, verify, proveSettlement, verifySettlement,
  artifactManifest, artifactManifestHash, canonicalJson,
  receiptHash, publicStateHash, validateIntentReceipt, validateSettlementReceipt,
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
  constructor(cfg: {
    senderPkh: string;
    operatorPkh: string;
    /** REQUIRED. Real Midnight execution/verification provider — construction
     *  throws without it, and throws if the provider's artifactManifestHash
     *  differs from the packaged SDK's 23-asset circuit manifest. */
    midnightProofProvider: MidnightProofProvider;
    escrowLovelace?: bigint;
    deadlineSeconds?: number;
  });

  initiateOffRamp(p: IntentParams)
      : Promise<{ initiate: InitiateOffRampResult; payeeSalt: string;
                  amountSalt: string; railQuote: RailQuote }>;

  generateZKProof(input: {
    intentId: string; cardanoLockAnchor: { txHash: string; outputIndex: number };
    payeeHandle: string; payeeSalt: string;
    fiatAmount: string; fiatCurrency: Currency; railQuoteDigest: string;
    principalLovelace: bigint; amountSalt: string;
    payeeCommitment: string; amountCommitment: string; adapterTag: string;
    complianceMask?: string; contractAddress?: string; priorReceipt?: ProofBundle;
  }): Promise<ProofBundle>;                         // ProofBundle = MidnightIntentReceipt

  verifyZKProof(proof: ProofBundle, expected: {
    intentId: string; cardanoLockAnchor: CardanoLockAnchor;
    payeeCommitment: string; amountCommitment: string; adapterTag: string;
    complianceFlag?: string;
  }): Promise<{ ok: true; verifyDurationMs: number }>;   // throws ProofVerifyError

  generateSettlementReceipt(input: { intentReceipt: ProofBundle; settlementDigest: string })
      : Promise<MidnightSettlementReceipt>;

  verifySettlementReceipt(receipt: MidnightSettlementReceipt, expected: {
    intentId: string; intentReceiptHash: string; settlementDigest: string;
    contractAddress?: string;
  }): Promise<{ ok: true; verifyDurationMs: number }>;   // throws ProofVerifyError

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

There is **no simulation fallback**: `prove`/`verify`/`proveSettlement`/`verifySettlement` all fail closed without a provider. A real provider factory ships in [`midnight-local-cli`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/midnight-local-cli) (`createMidnightProofProviderFromEnv()`); a test-only in-memory provider lives under `sdk/src/testing/`.

## `MidnightProofProvider`

```ts
interface MidnightProofProvider {
  readonly artifactManifestHash: string;   // must equal vkHash()
  generateIntentReceipt(inputs: ProveInputs): Promise<MidnightIntentReceipt>;
  verifyIntentReceipt(receipt, expected): Promise<VerifyResult>;
  generateSettlementReceipt(inputs: SettlementProveInputs): Promise<MidnightSettlementReceipt>;
  verifySettlementReceipt(receipt, expected): Promise<VerifyResult>;
}
```

Receipts contain **finalized public evidence only** (Midnight txId/txHash/blockHash/blockHeight per circuit, queried public contract state, timestamps, canonical `receiptHash`) — never witnesses. `validateIntentReceipt` / `validateSettlementReceipt` re-check canonical hashing and trusted public inputs offline.

## Cardano helpers

```ts
createAppLucid(role?: "sender" | "operator"): Promise<AppLucid>;   // Lucid Evolution bound to env mnemonic
addressPaymentPkh(addr: string, lucid: AppLucid): string;
paymentPkhFromAddress(addr: string): string;
paymentAddressFromPkh(network: Network, pkh: string): string;
escrowScript(blueprint?: BlueprintJson): Script;                   // Aiken PlutusV3 validator
escrowScriptAddress(network: Network, script?: Script): string;
escrowDatumCbor(input: EscrowDatumIn): string;
decodeEscrowDatumCbor(cbor: string): EscrowDatumIn;
releaseAuthorizationMessageForUtxo(lucid, utxoRef: EscrowOutRef,
                                   body: ReleaseAuthorizationBodyIn): Promise<string>;
releaseRedeemerCbor(input: ReleaseAuthorizationIn): string;
RELEASE_REDEEMER; REFUND_REDEEMER;

submitLockTx(lucid: AppLucid, datumInput: EscrowDatumIn, lockLovelace: bigint)
    : Promise<{ txHash: string; scriptAddress: string; lockLovelace: bigint; datumCbor: string }>;

submitReleaseTx(lucid: AppLucid, scriptUtxoRef: EscrowOutRef,
                authorization: ReleaseAuthorizationIn)
    : Promise<{ txHash: string; authorizationMessageCbor: string }>;

submitRefundTx(lucid: AppLucid, scriptUtxoRef: EscrowOutRef)
    : Promise<{ txHash: string }>;
```

Key input types:

```ts
interface EscrowDatumIn {
  intentId: string; payeeCommitment: string; amountCommitment: string;
  adapterTag: string; deadline: bigint /* POSIX ms */;
  circuitArtifactHash: string;              // = vkHash(), on-chain circuit_artifact_hash
  senderPkh: string; operatorPkh: string; oraclePublicKey: string;
}
interface EscrowOutRef { txHash: string; outputIndex: number }
interface ReleaseAuthorizationBodyIn {
  settlementDigest: string; midnightSettlementReceiptHash: string;
  authorizationExpiry: bigint /* POSIX ms */;
}
interface ReleaseAuthorizationIn extends ReleaseAuthorizationBodyIn { oracleSignature: string }
```

Guards enforced before submission: `submitLockTx` requires the connected wallet to match `datum.senderPkh`; `submitReleaseTx` requires the operator wallet, an unexpired authorization, and a validity window before both deadline and expiry; `submitRefundTx` requires the sender wallet and starts the validity window at/after the deadline. All three pay/return the **full escrow value** to the datum-bound address, matching what the validator enforces on-chain.

## Rail adapters

```ts
type RailId = "cashapp" | "wise" | "revolut";

interface RailAdapter {
  readonly id: RailId;
  readonly mode: "mock" | "sandbox";
  readonly capabilities: RailCapabilities;
  health(): RailAdapterHealth;
  quote(input): Promise<RailQuote>;
  submit(input): Promise<SubmitPaymentResult>;      // idempotent on intentId
  getStatus(input: { intentId; providerReference }): Promise<RailStatusObservation>;
  verifyWebhook(input: RailWebhookInput): RailWebhookVerification;
}
```

Mode is selected by `RAIL_ADAPTER_MODE=sandbox|mock`:

- **`sandbox`** — real provider HTTP with **no mock fallback**; missing configuration is a hard error surfaced via `health()`. **Wise:** strict sandbox client (provider quote-bound transfer, deterministic idempotency, authenticated status; needs a fresh `WISE_API_TOKEN`). **Revolut:** live sandbox **verified** — a real payment completed through the adapter (refresh-token grant; JWT `iss` = certificate redirect-URI domain). **Cash App:** implemented against the official Payouts API, **credential-gated** early-access partner product — no live evidence yet.
- **`mock`** — deterministic in-process simulators, **test-only** (`mockCashAppAdapter`, `mockWiseAdapter`, `mockRevolutAdapter`, `createDeterministicMockAdapter`).

Source: [`sdk/src/adapters/`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/tree/main/sdk/src/adapters).

## Settlement Oracle

```ts
function attestSettlement(in: { intentId; railTxRef; status }): OracleAttestation;
function verifyAttestation(att: OracleAttestation): boolean;
function verifyAdapterWebhook(payload, hmac): boolean;
function operatorPublicKeyHex(): string;
// from sdk/src/oracle/settlement-oracle.ts directly:
function signReleaseAuthorization(authorizationMessageCborHex: string): string;
function attestationFingerprint(att: OracleAttestation): string;
```

The oracle key comes from `OPERATOR_ED25519_SK_HEX`; `RAIL_WEBHOOK_HMAC_KEY` is required (fail-closed). Publish only `operatorPublicKeyHex()` to consumers.

## Commitment helpers

```ts
payeeCommitment(handle, salt): { commitment: string; secret: string };
amountCommitment({ fiatAmount, fiatCurrency, railQuoteDigest,
                   principalLovelace, salt }): { commitment: string; secret: string };
intentId({ adapter, senderPkh, payeeCommitment, amountCommitment, createdAt }): string;
adapterTag(adapter: string): string;
vkHash(): string;        // deterministic 23-asset circuit artifact manifest hash
circuitId(): string;     // "offramp:v1"
randomNonce(byteLen?: number): string;
settlementDigest({ intentId, railTxRef, status, signedAt }): string;
railQuoteDigest({ adapter, fiatAmount, fiatCurrency, rate, fees, quotedAt }): string;
sha256Hex(buf: Buffer): string;
```

Source: [`sdk/src/commitments.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/commitments.ts).

## Errors

```ts
class OracleError extends Error {}
class ProofVerifyError extends Error {}
class RailError extends Error { rail: RailId; }
```

`submitPayment` throws `RailError` if the adapter rejects; `verifyZKProof` / `verifySettlementReceipt` throw `ProofVerifyError`; `confirmSettlement` throws `OracleError` on HMAC mismatch or self-verify failure.

## Types

Full definitions (`IntentParams`, `InitiateOffRampResult`, `MidnightIntentReceipt`, `MidnightSettlementReceipt`, `ProofBundle`, `RailQuote`, `SubmitPaymentResult`, `RailStatusObservation`, `OracleAttestation`, …) live in [`sdk/src/types.ts`](https://github.com/Nucastio/MidnightZK-Off-Ramp-SDK-ADA-Web2-Payments/blob/main/sdk/src/types.ts).
