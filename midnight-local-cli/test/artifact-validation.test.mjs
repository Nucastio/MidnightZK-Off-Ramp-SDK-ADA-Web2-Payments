import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NEVER } from "rxjs";

import { artifactManifest, artifactManifestHash } from "@nucast/midnightzk-offramp-sdk";
import { validateOffRampArtifactDirectory } from "../dist/index.js";
import { verifyFinalizedTx } from "../dist/midnight-proof-provider.js";
import { createWalletAndMidnightProvider } from "../dist/providers.js";

const repoDir = path.resolve(import.meta.dirname, "../..");

async function artifactDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "offramp-midnight-artifacts-"));
  for (const artifact of artifactManifest().artifacts) {
    if (!("runtimePath" in artifact)) continue;
    const target = path.join(directory, artifact.runtimePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoDir, artifact.path), target);
  }
  return directory;
}

test("the exact configured Midnight artifact directory is hash-validated", async () => {
  const directory = await artifactDirectory();
  try {
    assert.equal(validateOffRampArtifactDirectory(directory), artifactManifestHash());

    const prover = artifactManifest().artifacts.find((artifact) => artifact.path.endsWith(".prover"));
    assert.ok(prover && "runtimePath" in prover);
    await writeFile(path.join(directory, prover.runtimePath), "tampered", "utf8");
    assert.throws(
      () => validateOffRampArtifactDirectory(directory),
      /Configured Midnight artifact (size|hash) mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wallet synchronization fails with a bounded timeout", async () => {
  const previous = process.env.MIDNIGHT_WALLET_SYNC_MS;
  process.env.MIDNIGHT_WALLET_SYNC_MS = "10";
  try {
    await assert.rejects(
      createWalletAndMidnightProvider({ wallet: { state: () => NEVER } }),
      /wallet sync: timed out after 10ms/,
    );
  } finally {
    if (previous === undefined) delete process.env.MIDNIGHT_WALLET_SYNC_MS;
    else process.env.MIDNIGHT_WALLET_SYNC_MS = previous;
  }
});

test("transaction verification timeout cancels polling without orphaned watches", async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: { transactions: [] } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const previous = process.env.MIDNIGHT_VERIFY_TX_MS;
  process.env.MIDNIGHT_VERIFY_TX_MS = "30";
  try {
    const txId = "10".repeat(32);
    const reason = await verifyFinalizedTx(`http://127.0.0.1:${address.port}`, {
      operation: "bindOffRampIntent",
      status: "SucceedEntirely",
      txId,
      identifiers: [txId],
      txHash: "20".repeat(32),
      blockHash: "30".repeat(32),
      blockHeight: 1,
      blockTimestamp: Math.floor(Date.now() / 1000),
      finalizedAtMs: Date.now(),
    });
    assert.match(reason, /was not found.*within 30ms/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const requestsAfterInflightDrain = requests;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(requests, requestsAfterInflightDrain);
  } finally {
    if (previous === undefined) delete process.env.MIDNIGHT_VERIFY_TX_MS;
    else process.env.MIDNIGHT_VERIFY_TX_MS = previous;
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("configured Midnight artifact validation fails when a critical asset is absent", async () => {
  const directory = await artifactDirectory();
  try {
    const generatedContract = artifactManifest().artifacts.find(
      (artifact) => artifact.path.endsWith("contract/index.js"),
    );
    assert.ok(generatedContract && "runtimePath" in generatedContract);
    await unlink(path.join(directory, generatedContract.runtimePath));
    assert.throws(
      () => validateOffRampArtifactDirectory(directory),
      /Missing configured Midnight artifact/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
