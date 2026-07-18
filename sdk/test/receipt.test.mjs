import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";

import * as sdkRoot from "../dist/index.js";
import { MockMidnightProofProvider } from "../dist/testing/mock-midnight-proof-provider.js";

const sdkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(sdkDir, "..");

const privateInput = {
  intentId: "10".repeat(32),
  cardanoLockAnchor: { txHash: "20".repeat(32), outputIndex: 0 },
  payeeHandle: "$receipt_test",
  payeeSalt: "30".repeat(16),
  fiatAmount: "12.50",
  fiatCurrency: "USD",
  railQuoteDigest: "40".repeat(32),
  principalLovelace: 2_000_000n,
  amountSalt: "50".repeat(16),
  adapterTag: "60".repeat(32),
};
const input = {
  ...privateInput,
  payeeCommitment: sdkRoot.payeeCommitment(privateInput.payeeHandle, privateInput.payeeSalt).commitment,
  amountCommitment: sdkRoot.amountCommitment({
    fiatAmount: privateInput.fiatAmount,
    fiatCurrency: privateInput.fiatCurrency,
    railQuoteDigest: privateInput.railQuoteDigest,
    principalLovelace: privateInput.principalLovelace,
    salt: privateInput.amountSalt,
  }).commitment,
};

async function receiptFixture() {
  const provider = new MockMidnightProofProvider();
  const receipt = await provider.generateIntentReceipt(input);
  const expected = {
    intentId: input.intentId,
    cardanoLockAnchor: input.cardanoLockAnchor,
    payeeCommitment: receipt.publicInputs.payeeCommitment,
    amountCommitment: receipt.publicInputs.amountCommitment,
    adapterTag: input.adapterTag,
  };
  return { provider, receipt, expected };
}

function rehash(receipt) {
  receipt.receiptHash = sdkRoot.receiptHash(receipt);
  return receipt;
}

test("receipt canonicalization is stable and tampering is rejected", async () => {
  assert.equal(
    sdkRoot.canonicalJson({ z: 1, a: { y: 2, x: 3 } }),
    sdkRoot.canonicalJson({ a: { x: 3, y: 2 }, z: 1 }),
  );

  const { provider, receipt, expected } = await receiptFixture();
  assert.equal((await provider.verifyIntentReceipt(receipt, expected)).ok, true);
  assert.equal(sdkRoot.receiptHash(receipt), receipt.receiptHash);

  const tampered = structuredClone(receipt);
  tampered.transactions.proveAmountBinding.txHash = "ff".repeat(32);
  const result = await provider.verifyIntentReceipt(tampered, expected);
  assert.equal(result.ok, false);
  assert.match(result.reason, /receipt hash mismatch/);

  const serialized = JSON.stringify(receipt);
  for (const privateValue of [input.payeeHandle, input.payeeSalt, input.amountSalt]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal(serialized.includes("payeeSecret"), false);
  assert.equal(serialized.includes("amountSecret"), false);
});

test("trusted public-input tampering is rejected even for a canonical receipt", async () => {
  const { provider, receipt, expected } = await receiptFixture();
  const result = await provider.verifyIntentReceipt(receipt, {
    ...expected,
    amountCommitment: "ff".repeat(32),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /amount commitment mismatch/);
});

test("receipt provenance and finalized metadata are validated after rehashing", async () => {
  const { provider, receipt, expected } = await receiptFixture();

  const wrongContract = rehash(structuredClone(receipt));
  wrongContract.contractId = "other";
  wrongContract.receiptHash = sdkRoot.receiptHash(wrongContract);
  assert.match((await provider.verifyIntentReceipt(wrongContract, expected)).reason, /unsupported intent receipt/);

  const invalidHeight = rehash(structuredClone(receipt));
  invalidHeight.transactions.proveAmountBinding.blockHeight = -1;
  invalidHeight.receiptHash = sdkRoot.receiptHash(invalidHeight);
  assert.match((await provider.verifyIntentReceipt(invalidHeight, expected)).reason, /block height is invalid/);

  const invalidBlockTime = rehash(structuredClone(receipt));
  invalidBlockTime.transactions.proveAmountBinding.blockTimestamp = 0;
  invalidBlockTime.receiptHash = sdkRoot.receiptHash(invalidBlockTime);
  assert.match((await provider.verifyIntentReceipt(invalidBlockTime, expected)).reason, /block timestamp is invalid/);

  const invalidTimeline = rehash(structuredClone(receipt));
  invalidTimeline.timestamps.completedAtMs = invalidTimeline.timestamps.startedAtMs - 1;
  invalidTimeline.receiptHash = sdkRoot.receiptHash(invalidTimeline);
  assert.match((await provider.verifyIntentReceipt(invalidTimeline, expected)).reason, /timestamps are out of order/);

  const afterCompletion = rehash(structuredClone(receipt));
  afterCompletion.transactions.proveAmountBinding.finalizedAtMs = afterCompletion.timestamps.completedAtMs + 1;
  afterCompletion.receiptHash = sdkRoot.receiptHash(afterCompletion);
  assert.match((await provider.verifyIntentReceipt(afterCompletion, expected)).reason, /finalized after receipt completion/);
});

test("settlement receipts bind the finalized anchor and state", async () => {
  const { provider, receipt } = await receiptFixture();
  const settlementDigest = "70".repeat(32);
  const settlement = await provider.generateSettlementReceipt({ intentReceipt: receipt, settlementDigest });
  const expected = {
    intentId: receipt.intentId,
    intentReceiptHash: receipt.receiptHash,
    settlementDigest,
    contractAddress: receipt.contractAddress,
  };
  assert.equal((await provider.verifySettlementReceipt(settlement, expected)).ok, true);

  const wrongAnchor = structuredClone(settlement);
  wrongAnchor.publicState.l1Anchor = "ff".repeat(32);
  wrongAnchor.publicStateHash = sdkRoot.publicStateHash(wrongAnchor.publicState);
  wrongAnchor.receiptHash = sdkRoot.receiptHash(wrongAnchor);
  assert.match((await provider.verifySettlementReceipt(wrongAnchor, expected)).reason, /settlement ledger anchor mismatch/);
});

test("SDK and proof functions fail closed without a configured provider", async () => {
  assert.throws(
    () => new sdkRoot.OffRampSDK({ senderPkh: "00".repeat(28), operatorPkh: "11".repeat(28) }),
    /MidnightProofProvider is required/,
  );
  await assert.rejects(() => sdkRoot.prove(undefined, input), /MidnightProofProvider is required/);
});

test("artifact manifest hash is reproducible from committed Compact artifacts", async () => {
  execFileSync(process.execPath, ["scripts/generate-artifact-manifest.mjs", "--check"], { cwd: sdkDir });
  const manifest = sdkRoot.artifactManifest();
  assert.equal(manifest.contractId, "offramp");
  assert.equal(manifest.circuits.length, 5);
  assert.equal(manifest.artifacts.length, 23);
  assert.equal(manifest.artifacts.some((entry) => entry.path.endsWith("offramp.compact")), true);
  assert.equal(manifest.artifacts.some((entry) => entry.path.endsWith("contract-info.json")), true);
  assert.equal(manifest.artifacts.some((entry) => entry.path.endsWith("contract/index.js")), true);
  assert.equal(manifest.artifacts.filter((entry) => entry.path.endsWith(".prover")).length, 5);
  assert.equal(manifest.artifacts.filter((entry) => entry.path.endsWith(".verifier")).length, 5);
  assert.equal(manifest.artifacts.filter((entry) => entry.path.endsWith(".bzkir")).length, 5);
  assert.equal(manifest.artifacts.filter((entry) => entry.path.endsWith(".zkir") && !entry.path.endsWith(".bzkir")).length, 5);
  assert.equal(manifest.artifacts.some((entry) => entry.path.endsWith(".map")), false);

  for (const entry of manifest.artifacts) {
    const bytes = await readFile(path.join(repoDir, entry.path));
    assert.equal(bytes.length, entry.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
  const generatedContractPath = path.join(repoDir, "contract/src/managed/offramp/contract/index.js");
  assert.equal((await readFile(generatedContractPath, "utf8")).includes("sourceMappingURL"), false);
  await assert.rejects(access(`${generatedContractPath}.map`));
  assert.match(sdkRoot.artifactManifestHash(), /^[0-9a-f]{64}$/);
  assert.equal(sdkRoot.vkHash(), sdkRoot.artifactManifestHash());
});

test("test mock is isolated from production root exports", () => {
  assert.equal("MockMidnightProofProvider" in sdkRoot, false);
  assert.equal(typeof MockMidnightProofProvider, "function");
});
