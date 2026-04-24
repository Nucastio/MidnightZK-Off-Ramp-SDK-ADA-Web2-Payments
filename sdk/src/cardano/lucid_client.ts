import {
  Blockfrost,
  Lucid,
  walletFromSeed,
  type LucidEvolution,
  type Network,
} from "@lucid-evolution/lucid";

export type AppLucid = LucidEvolution;

export interface CardanoEnv {
  network: Network;
  blockfrostUrl: string;
  blockfrostProjectId: string;
  mnemonic: string;
}

export function cardanoEnvFromProcess(role: "sender" | "operator" = "sender"): CardanoEnv {
  const network = (process.env.CARDANO_NETWORK ?? "Preprod") as Network;
  const blockfrostUrl =
    process.env.BLOCKFROST_URL ?? "https://cardano-preprod.blockfrost.io/api/v0";
  const blockfrostProjectId =
    process.env.BLOCKFROST_PROJECT_ID ?? process.env.BLOCKFROST_API_KEY ?? "";
  if (!blockfrostProjectId) {
    throw new Error("BLOCKFROST_PROJECT_ID is not set");
  }
  const mnemonic =
    (role === "operator"
      ? process.env.OPERATOR_WALLET_MNEMONIC
      : process.env.SENDER_WALLET_MNEMONIC) ??
    process.env.WALLET_MNEMONIC ??
    "";
  if (!mnemonic) {
    throw new Error("WALLET_MNEMONIC is not set");
  }
  return { network, blockfrostUrl, blockfrostProjectId, mnemonic };
}

export async function createAppLucid(role: "sender" | "operator" = "sender"): Promise<AppLucid> {
  const env = cardanoEnvFromProcess(role);
  const lucid = await Lucid(new Blockfrost(env.blockfrostUrl, env.blockfrostProjectId), env.network);
  lucid.selectWallet.fromSeed(env.mnemonic.trim(), { addressType: "Base", accountIndex: 0 });
  return lucid;
}

export function addressPaymentPkh(addressBech32: string, lucid: AppLucid): string {
  const details = lucid.utils.getAddressDetails(addressBech32);
  const pkh = details.paymentCredential?.hash;
  if (!pkh) throw new Error("address has no payment credential hash");
  return pkh;
}

export function senderPkhFromMnemonic(mnemonic: string, network: Network): string {
  const w = walletFromSeed(mnemonic.trim(), { network, addressType: "Base", accountIndex: 0 });
  // walletFromSeed returns the wallet's address; we extract the payment PKH via a freshly-instantiated Lucid utility.
  // Simpler: derive directly via @lucid-evolution/utils.
  // To avoid an extra import surface here, callers should prefer `addressPaymentPkh(await lucid.wallet().address(), lucid)`.
  return w.address;
}
