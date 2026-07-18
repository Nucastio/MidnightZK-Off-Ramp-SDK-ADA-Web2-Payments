import * as ledger from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { DEFAULT_CONFIG, levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, ProofProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';
import type { WalletContext } from './wallet.js';
import type { OffRampMidnightConfig } from './config.js';
import type { OffRampPrivateState } from '@offramp/midnight-contract';
import { OffRamp, offRampPrivateStateId } from '@offramp/midnight-contract';

type OffRampCircuitId = keyof OffRamp.ProvableCircuits<any>;

const debug = (msg: string, extra?: Record<string, unknown>) => {
  if (process.env.MIDNIGHT_LOCAL_CLI_DEBUG === '1' || process.env.MIDNIGHT_LOCAL_CLI_DEBUG === 'true') {
    // eslint-disable-next-line no-console
    console.error(`[offramp-midnight-local-cli] ${new Date().toISOString()} ${msg}`, extra ?? '');
  }
};

function positiveTimeoutMs(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const walletSyncMs = positiveTimeoutMs("MIDNIGHT_WALLET_SYNC_MS", 180_000);
  const latestSynced = await Rx.firstValueFrom(ctx.wallet.state().pipe(
    Rx.filter((state) => state.isSynced),
    Rx.timeout({ first: walletSyncMs }),
  )).catch((error: unknown) => {
    if (error instanceof Rx.TimeoutError) {
      throw new Error(`wallet sync: timed out after ${walletSyncMs}ms`);
    }
    throw error;
  });
  return {
    getCoinPublicKey() {
      return latestSynced.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return latestSynced.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const balanceMs = Number.parseInt(process.env.MIDNIGHT_BALANCE_TX_MS ?? '900000', 10);
      debug('balanceTx: start', { timeoutMs: balanceMs });
      const run = async () => {
        const recipe = await ctx.wallet.balanceUnboundTransaction(
          tx,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
        );

        const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }

        return ctx.wallet.finalizeRecipe(recipe);
      };
      try {
        const out = await withTimeout(run(), balanceMs, 'balanceTx');
        debug('balanceTx: done');
        return out;
      } catch (e) {
        debug('balanceTx: error', { err: String(e) });
        throw e;
      }
    },
    async submitTx(tx) {
      debug('submitTx: calling wallet.submitTransaction');
      await ctx.wallet.submitTransaction(tx);
      const ids = tx.identifiers().map((id) => id.toLowerCase());
      const head = ids[0];
      if (head === undefined) {
        throw new Error('Submitted transaction has no identifiers');
      }
      debug('submitTx: done', { segmentCount: ids.length, firstIdPrefix: head.slice(0, 24) });
      return head;
    },
  };
};

function wrapProofProvider(base: ProofProvider): ProofProvider {
  return {
    async proveTx(unprovenTx, partialProveTxConfig) {
      debug('proveTx: start (ZK proof generation)');
      try {
        const out = await base.proveTx(unprovenTx, partialProveTxConfig);
        debug('proveTx: done');
        return out;
      } catch (e) {
        debug('proveTx: error', { err: String(e) });
        throw e;
      }
    },
  };
}

function ldbPassword(): string {
  const p = process.env.MIDNIGHT_LDB_PASSWORD;
  if (p && p.length >= 16) return p;
  return 'NuAuth-local-dev-1!!';
}

export async function configureMidnightContractProviders<
  PrivateStateId extends string,
  CircuitId extends string,
>(
  ctx: WalletContext,
  config: Pick<OffRampMidnightConfig, 'indexer' | 'indexerWS' | 'proofServer'>,
  options: {
    artifactsDir: string;
    privateStateStoreName: string;
    privateStateId: PrivateStateId;
  },
) {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(options.artifactsDir);
  const basePublicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId>({
      ...DEFAULT_CONFIG,
      privateStateStoreName: options.privateStateStoreName,
      privateStoragePasswordProvider: async () => ldbPassword(),
      accountId: walletAndMidnightProvider.getCoinPublicKey(),
    }),
    publicDataProvider: basePublicDataProvider,
    zkConfigProvider,
    proofProvider: wrapProofProvider(httpClientProofProvider(config.proofServer, zkConfigProvider)),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}

export async function configureOffRampProviders(ctx: WalletContext, config: OffRampMidnightConfig) {
  return configureMidnightContractProviders<typeof offRampPrivateStateId, OffRampCircuitId>(
    ctx,
    config,
    {
      artifactsDir: config.offRampArtifactsDir,
      privateStateStoreName: config.privateStateStoreName,
      privateStateId: offRampPrivateStateId,
    },
  );
}

export type { OffRampPrivateState };
