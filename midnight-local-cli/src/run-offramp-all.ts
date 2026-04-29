/**
 * Deploy `offramp` + exercise all 5 circuits end-to-end:
 *   constructor → bindOffRampIntent → provePayeeBinding → proveAmountBinding
 *               → proveComplianceFlag → proveOffRampSettlement
 *
 * Env: `MIDNIGHT_DEPLOY_NETWORK` (`undeployed` | `preview` | `preprod`),
 *      `BIP39_MNEMONIC`, optional `OFFRAMP_{PAYEE,AMOUNT}_SECRET_HEX`,
 *      `OFFRAMP_L1_ANCHOR_HEX`, `OFFRAMP_JURISDICTION_HEX`.
 */
import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import WebSocket from 'ws';
import * as bip39 from 'bip39';
import * as Rx from 'rxjs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { offRampPrivateStateId } from '@offramp/midnight-contract';
import { offRampCompiledContractLocal } from './offramp-compiled-contract.js';
import { OffRampMidnightConfig } from './config.js';
import { configureOffRampProviders } from './providers.js';
import { initWalletWithSeed } from './wallet.js';
import { ensureDustReady } from './dust.js';

(globalThis as any).WebSocket = WebSocket;

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length !== 64) throw new Error('expected 32-byte hex string');
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

function deriveCommitment(domain: string, secret: Uint8Array): Uint8Array {
  return sha256Bytes(Uint8Array.from(Buffer.concat([Buffer.from(pad32(domain)), Buffer.from(secret)])));
}

interface TxIdsLike { txId: unknown; txHash: unknown; blockHeight?: unknown }
function logTx(label: string, pub: TxIdsLike, rows: Record<string, unknown>[]) {
  const bh = pub.blockHeight !== undefined ? ` blockHeight=${pub.blockHeight}` : '';
  console.log(`${label}: txId=${String(pub.txId)} txHash=${String(pub.txHash)}${bh}`);
  rows.push({
    kind: label,
    txId: String(pub.txId),
    txHash: String(pub.txHash),
    blockHeight: pub.blockHeight !== undefined ? Number(pub.blockHeight) : undefined,
    at: new Date().toISOString(),
  });
}

async function main(): Promise<void> {
  const mnemonic = process.env.BIP39_MNEMONIC;
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    console.error('Set valid BIP39_MNEMONIC');
    process.exit(1);
  }

  const config = new OffRampMidnightConfig();
  const seed = Buffer.from(await bip39.mnemonicToSeed(mnemonic));
  const walletCtx = await initWalletWithSeed(seed, config);

  console.log('Waiting for wallet sync…');
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log('Synced.');

  console.log('Ensuring DUST is ready…');
  await ensureDustReady(walletCtx, { timeoutMs: 240_000 });
  console.log('DUST ready.');

  const payeeSecret = hexToBytes32(process.env.OFFRAMP_PAYEE_SECRET_HEX ?? '01'.repeat(32));
  const amountSecret = hexToBytes32(process.env.OFFRAMP_AMOUNT_SECRET_HEX ?? '02'.repeat(32));
  const jurisdictionAttr = hexToBytes32(process.env.OFFRAMP_JURISDICTION_HEX ?? '03'.repeat(32));

  const payee = deriveCommitment('offramp:payee:v1', payeeSecret);
  const amount = deriveCommitment('offramp:amount:v1', amountSecret);
  const adapter = sha256Bytes(Buffer.from('offramp:adapter:v1|cashapp', 'utf8'));
  const intent = sha256Bytes(Uint8Array.from(Buffer.concat([Buffer.from(payee), Buffer.from(amount), Buffer.from(adapter)])));
  const l1Anchor = hexToBytes32(process.env.OFFRAMP_L1_ANCHOR_HEX ?? 'aa'.repeat(32));
  const allowedMask = jurisdictionAttr;
  const settleDigest = hexToBytes32(process.env.OFFRAMP_SETTLEMENT_DIGEST_HEX ?? 'bb'.repeat(32));

  const providers = await configureOffRampProviders(walletCtx, config);

  console.log('Deploying offramp on', config.networkId, '…');
  const deployed = await deployContract(providers, {
    compiledContract: offRampCompiledContractLocal,
    privateStateId: offRampPrivateStateId,
    initialPrivateState: {
      payeeSecret,
      amountSecret,
      jurisdictionAttr,
    },
    args: [intent, payee, amount, adapter],
  });

  const rows: Record<string, unknown>[] = [];
  const deployPub = deployed.deployTxData.public;
  logTx('deploy', deployPub, rows);
  console.log('Contract address:', deployPub.contractAddress);

  const { callTx } = deployed;
  logTx('bindOffRampIntent', (await callTx.bindOffRampIntent(l1Anchor)).public, rows);
  logTx('provePayeeBinding (ZK)', (await callTx.provePayeeBinding()).public, rows);
  logTx('proveAmountBinding (ZK)', (await callTx.proveAmountBinding()).public, rows);
  logTx('proveComplianceFlag (ZK)', (await callTx.proveComplianceFlag(allowedMask)).public, rows);
  logTx('proveOffRampSettlement (ZK)', (await callTx.proveOffRampSettlement(settleDigest)).public, rows);

  // Persist evidence for testnet-evidence.md.
  const dataDir = process.env.OFFRAMP_DATA_DIR ?? '../data';
  mkdirSync(dataDir, { recursive: true });
  const path = `${dataDir}/midnight-evidence.json`;
  let arr: Record<string, unknown>[] = [];
  if (existsSync(path)) arr = JSON.parse(readFileSync(path, 'utf8'));
  arr.push({ kind: 'PIPELINE', network: config.networkId, contractAddress: deployPub.contractAddress, rows, at: new Date().toISOString() });
  writeFileSync(path, JSON.stringify(arr, null, 2));
  console.log('Wrote', path);

  console.log('Done. All off-ramp ZK circuits submitted on', config.networkId, '.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
