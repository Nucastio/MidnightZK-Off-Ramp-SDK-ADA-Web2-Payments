/**
 * Deploy `offramp` to Midnight (**undeployed** local Docker or **preview / preprod** public RPC).
 *
 * Env:
 * - `MIDNIGHT_DEPLOY_NETWORK` – `undeployed` (default), `preview`, or `preprod`.
 * - `BIP39_MNEMONIC` – funded on the selected Midnight network. Faucets:
 *   - https://faucet.preview.midnight.network/
 *   - https://faucet.preprod.midnight.network/
 * - `OFFRAMP_INTENT_HEX` / `OFFRAMP_PAYEE_HEX` / `OFFRAMP_AMOUNT_HEX` / `OFFRAMP_ADAPTER_HEX` —
 *   64 hex chars (32 bytes) each. If unset, deterministic demo values are used.
 * - `OFFRAMP_PAYEE_SECRET_HEX` / `OFFRAMP_AMOUNT_SECRET_HEX` — 32-byte private witnesses that
 *   the prover will use; defaults are `01..` / `02..` (constructor only needs the commitments).
 */
import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { offRampPrivateStateId, OffRamp } from '@offramp/midnight-contract';
import { offRampCompiledContractLocal } from './offramp-compiled-contract.js';
import { OffRampMidnightConfig } from './config.js';
import { configureOffRampProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string, got: ' + hex);
  return Uint8Array.from(Buffer.from(h, 'hex'));
}

function pad32(input: string): Uint8Array {
  const out = new Uint8Array(32);
  const b = Buffer.from(input, 'utf8');
  out.set(b.subarray(0, Math.min(32, b.length)));
  return out;
}

function sha256Bytes(input: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(input).digest());
}

/** Same domain-separated commitment helper as `sdk/src/commitments.ts`. */
function deriveCommitment(domain: string, secret: Uint8Array): Uint8Array {
  return sha256Bytes(Uint8Array.from(Buffer.concat([Buffer.from(pad32(domain)), Buffer.from(secret)])));
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set a valid BIP39_MNEMONIC (faucet on the selected Midnight network).');
    process.exit(1);
  }

  const config = new OffRampMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  // ── Constructor args: 4 × Bytes<32> in order [intent, payee, amount, adapter].
  // Defaults derive from `OFFRAMP_*_SECRET_HEX` so subsequent prove calls match.
  const payeeSecret = hexToBytes32(process.env.OFFRAMP_PAYEE_SECRET_HEX ?? '01'.repeat(32));
  const amountSecret = hexToBytes32(process.env.OFFRAMP_AMOUNT_SECRET_HEX ?? '02'.repeat(32));

  const payee = process.env.OFFRAMP_PAYEE_HEX
    ? hexToBytes32(process.env.OFFRAMP_PAYEE_HEX)
    : deriveCommitment('offramp:payee:v1', payeeSecret);
  const amount = process.env.OFFRAMP_AMOUNT_HEX
    ? hexToBytes32(process.env.OFFRAMP_AMOUNT_HEX)
    : deriveCommitment('offramp:amount:v1', amountSecret);
  const adapter = process.env.OFFRAMP_ADAPTER_HEX
    ? hexToBytes32(process.env.OFFRAMP_ADAPTER_HEX)
    : sha256Bytes(Buffer.from('offramp:adapter:v1|cashapp', 'utf8'));
  const intent = process.env.OFFRAMP_INTENT_HEX
    ? hexToBytes32(process.env.OFFRAMP_INTENT_HEX)
    : sha256Bytes(Uint8Array.from(Buffer.concat([Buffer.from(payee), Buffer.from(amount), Buffer.from(adapter)])));

  const providers = await configureOffRampProviders(walletCtx, config);

  console.log('Deploying offramp on', config.networkId, '…');
  console.log('  intentId =', Buffer.from(intent).toString('hex'));
  console.log('  payee    =', Buffer.from(payee).toString('hex'));
  console.log('  amount   =', Buffer.from(amount).toString('hex'));
  console.log('  adapter  =', Buffer.from(adapter).toString('hex'));

  const deployed = await deployContract(providers, {
    compiledContract: offRampCompiledContractLocal,
    privateStateId: offRampPrivateStateId,
    initialPrivateState: {
      payeeSecret,
      amountSecret,
    },
    args: [intent, payee, amount, adapter],
  });

  const pub = deployed.deployTxData.public;
  const contractAddress = pub.contractAddress;
  console.log('Deployed offramp at:', contractAddress);

  // ── Persist deployment info for `run-offramp-all`
  const dataDir = process.env.OFFRAMP_DATA_DIR ?? '../data';
  mkdirSync(dataDir, { recursive: true });
  const record = {
    network: config.networkId,
    contractAddress,
    intentId: Buffer.from(intent).toString('hex'),
    payeeCommitment: Buffer.from(payee).toString('hex'),
    amountCommitment: Buffer.from(amount).toString('hex'),
    adapterTag: Buffer.from(adapter).toString('hex'),
    payeeSecretHex: Buffer.from(payeeSecret).toString('hex'),
    amountSecretHex: Buffer.from(amountSecret).toString('hex'),
    deployedAt: new Date().toISOString(),
  };
  const arrPath = `${dataDir}/midnight-evidence.json`;
  let arr: Record<string, unknown>[] = [];
  if (existsSync(arrPath)) arr = JSON.parse(readFileSync(arrPath, 'utf8'));
  arr.push({ kind: 'DEPLOY', ...record });
  writeFileSync(arrPath, JSON.stringify(arr, null, 2));
  console.log('Wrote', arrPath);

  if (!('initialContractState' in pub) || !pub.initialContractState) {
    console.log('(deploy returned no initialContractState — skipping ledger snapshot)');
    return;
  }
  try {
    const ledger = OffRamp.ledger(pub.initialContractState.data);
    const ic = ledger.intentId as unknown as Uint8Array;
    console.log('Ledger snapshot: intentId =', Buffer.from(ic).toString('hex'));
  } catch (e) {
    console.log('(ledger parse skipped:', (e as Error).message, ')');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
