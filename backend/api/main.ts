/**
 * Production entrypoint: wires real Cardano / Midnight / rail-adapter / oracle
 * dependencies into the Hono app defined in `app.ts` and serves it.
 */
import "dotenv/config";
import { serve } from "@hono/node-server";

import {
  OffRampSDK,
  createAppLucid,
  paymentPkhFromAddress,
  escrowScriptAddress,
  submitLockTx,
  submitReleaseTx,
  submitRefundTx,
  releaseAuthorizationMessageForUtxo,
  vkHash,
  adapters,
  getAdapter,
} from "../../sdk/src/index.ts";
import { resolveEscrowUtxo } from "../../sdk/src/cardano/escrow_script.ts";
import {
  attestSettlement,
  operatorPublicKeyHex,
  signReleaseAuthorization,
  verifyAttestation,
} from "../../sdk/src/oracle/settlement-oracle.ts";
import { createMidnightProofProviderFromEnv } from "../../midnight-local-cli/src/index.ts";
import { createApp, type AppDeps } from "./app.ts";

const PORT = Number(process.env.API_PORT ?? "8788");

let midnightProofProvider: ReturnType<typeof createMidnightProofProviderFromEnv> | undefined;
function getMidnightProofProvider() {
  midnightProofProvider ??= createMidnightProofProviderFromEnv();
  return midnightProofProvider;
}

async function buildSdk(): Promise<{ sdk: OffRampSDK; senderPkh: string }> {
  const lucid = await createAppLucid("sender");
  const senderAddr = await lucid.wallet().address();
  const senderPkh = paymentPkhFromAddress(senderAddr);
  // Operator is the same wallet in this demo (single seed for end-to-end runs).
  const sdk = new OffRampSDK({
    senderPkh,
    operatorPkh: senderPkh,
    midnightProofProvider: getMidnightProofProvider(),
  });
  return { sdk, senderPkh };
}

const allowedOrigins = (process.env.OFFRAMP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const deps: AppDeps = {
  allowedOrigins,
  testEndpointsEnabled: process.env.OFFRAMP_ENABLE_TEST_ENDPOINTS === "1",
  testEndpointToken: process.env.OFFRAMP_TEST_TOKEN?.trim() || undefined,
  releaseAuthWindowMs: Number(process.env.OFFRAMP_RELEASE_AUTH_WINDOW_MS ?? "600000"),
  buildSdk,
  getAdapter,
  healthInfo: () => {
    const network = process.env.CARDANO_NETWORK ?? "Preprod";
    return {
      ok: true,
      service: "midnightzk-offramp-sdk",
      version: "0.1.0",
      cardano: {
        backend: process.env.CARDANO_BACKEND ?? "blockfrost",
        network,
        escrowScriptAddress: escrowScriptAddress(network as never),
      },
      midnight: { circuitId: "offramp:v1", vkHash: vkHash() },
      oracle: { publicKeyHex: operatorPublicKeyHex() },
      railAdapters: Object.keys(adapters),
      railAdapterMode: process.env.RAIL_ADAPTER_MODE ?? "mock",
    };
  },
  adaptersInfo: () => ({
    adapters: Object.keys(adapters),
    mode: process.env.RAIL_ADAPTER_MODE ?? "mock",
  }),
  cardano: {
    async submitLock(rec) {
      const lucid = await createAppLucid("sender");
      const senderAddr = await lucid.wallet().address();
      const senderPkh = paymentPkhFromAddress(senderAddr);
      const operatorPkh = senderPkh; // single-seed demo
      const datum = {
        intentId: rec.initiate.intentId,
        payeeCommitment: rec.initiate.payeeCommitment,
        amountCommitment: rec.initiate.amountCommitment,
        adapterTag: rec.initiate.adapterTag,
        deadline: BigInt(rec.initiate.deadline) * 1000n, // POSIX ms for on-chain
        circuitArtifactHash: rec.initiate.vkHash,
        senderPkh,
        operatorPkh,
        oraclePublicKey: operatorPublicKeyHex(),
      };
      const res = await submitLockTx(lucid, datum, BigInt(rec.initiate.escrowLovelace));
      return { txHash: res.txHash, scriptAddress: res.scriptAddress, outputIndex: 0 };
    },
    async confirmLock(outRef, intentId) {
      const lucid = await createAppLucid("sender");
      try {
        const resolved = await resolveEscrowUtxo(lucid, outRef);
        if (resolved.datum.intentId !== intentId) {
          return { confirmed: false, reason: "on-chain datum intentId does not match this intent" };
        }
        return { confirmed: true };
      } catch (e) {
        return { confirmed: false, reason: (e as Error).message };
      }
    },
    async buildReleaseAuthorizationMessage(outRef, body) {
      const lucid = await createAppLucid("operator");
      return releaseAuthorizationMessageForUtxo(lucid, outRef, body);
    },
    async submitRelease(outRef, auth) {
      const lucid = await createAppLucid("operator");
      const res = await submitReleaseTx(lucid, outRef, auth);
      return { txHash: res.txHash };
    },
    async submitRefund(outRef) {
      const lucid = await createAppLucid("sender");
      const res = await submitRefundTx(lucid, outRef);
      return { txHash: res.txHash };
    },
  },
  oracle: {
    attest: attestSettlement,
    verifyAttestation,
    signReleaseAuthorization,
  },
  async runTestSuite(runsPerRail) {
    const { runInternalTestSuite } = await import("../../scripts/internal-test-lib.ts");
    return runInternalTestSuite({ runsPerRail });
  },
};

const app = createApp(deps);

console.log(`offramp api listening on http://127.0.0.1:${PORT}`);
console.log(`  docs:    http://127.0.0.1:${PORT}/docs`);
console.log(`  openapi: http://127.0.0.1:${PORT}/api/openapi.json`);
if (allowedOrigins.length === 0) {
  console.log("  CORS:    no allowed origins configured (set OFFRAMP_ALLOWED_ORIGINS)");
} else {
  console.log(`  CORS:    ${allowedOrigins.join(", ")}`);
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
