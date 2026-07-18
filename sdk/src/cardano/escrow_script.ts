import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDoubleCborEncoding,
  CBOREncodingLevel,
  credentialToAddress,
  getAddressDetails,
  keyHashToCredential,
  validatorToAddress,
} from "@lucid-evolution/utils";
import {
  Constr,
  Data,
  type Network,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import type { AppLucid } from "./lucid_client.js";

const _here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BLUEPRINT_PATH = join(_here, "../../../cardano/escrow/plutus.json");
const RELEASE_DOMAIN_SEPARATOR = Buffer.from("MIDNIGHT_OFFRAMP_RELEASE_V1", "utf8").toString("hex");

export interface BlueprintJson {
  preamble: { plutusVersion: string };
  validators: Array<{ title: string; compiledCode?: string }>;
}

export interface EscrowOutRef {
  txHash: string;
  outputIndex: number;
}

export interface EscrowDatumIn {
  intentId: string;
  payeeCommitment: string;
  amountCommitment: string;
  adapterTag: string;
  deadline: bigint; // POSIX milliseconds
  circuitArtifactHash: string;
  senderPkh: string;
  operatorPkh: string;
  oraclePublicKey: string;
}

export interface ReleaseAuthorizationBodyIn {
  settlementDigest: string;
  midnightSettlementReceiptHash: string;
  authorizationExpiry: bigint; // POSIX milliseconds
}

export interface ReleaseAuthorizationIn extends ReleaseAuthorizationBodyIn {
  oracleSignature: string;
}

export interface ResolvedEscrowUtxo {
  utxo: UTxO;
  datum: EscrowDatumIn;
  scriptAddress: string;
  senderAddress: string;
  operatorAddress: string;
}

export function loadEscrowBlueprint(blueprintPath?: string): BlueprintJson {
  const fromEnv = process.env.OFFRAMP_ESCROW_BLUEPRINT?.trim();
  const path = blueprintPath ?? (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BLUEPRINT_PATH);
  return JSON.parse(readFileSync(path, "utf8")) as BlueprintJson;
}

function plutusType(version: string): Script["type"] {
  if (version === "v3") return "PlutusV3";
  if (version === "v2") return "PlutusV2";
  return "PlutusV1";
}

export function escrowScript(blueprint: BlueprintJson = loadEscrowBlueprint()): Script {
  const row = blueprint.validators.find((v) => v.title.endsWith(".spend"));
  const raw = row?.compiledCode;
  if (!raw) throw new Error("escrow: no .spend validator compiledCode in blueprint");
  const level = CBOREncodingLevel(raw);
  const script = level === "double" ? raw : applyDoubleCborEncoding(raw);
  return { type: plutusType(blueprint.preamble.plutusVersion), script };
}

export function escrowScriptAddress(network: Network, script: Script = escrowScript()): string {
  return validatorToAddress(network, script);
}

function normalizeHex(name: string, value: string, bytes: number): string {
  const normalized = value.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length !== bytes * 2) {
    throw new Error(`${name} must be exactly ${bytes} bytes of hex`);
  }
  return normalized;
}

function nonNegativeInteger(name: string, value: bigint): bigint {
  if (value < 0n) throw new Error(`${name} must be non-negative`);
  return value;
}

function validateOutRef(outRef: EscrowOutRef): EscrowOutRef {
  return {
    txHash: normalizeHex("scriptUtxoRef.txHash", outRef.txHash, 32),
    outputIndex: (() => {
      if (!Number.isSafeInteger(outRef.outputIndex) || outRef.outputIndex < 0) {
        throw new Error("scriptUtxoRef.outputIndex must be a non-negative safe integer");
      }
      return outRef.outputIndex;
    })(),
  };
}

export function validateEscrowDatum(datum: EscrowDatumIn): EscrowDatumIn {
  return {
    intentId: normalizeHex("intentId", datum.intentId, 32),
    payeeCommitment: normalizeHex("payeeCommitment", datum.payeeCommitment, 32),
    amountCommitment: normalizeHex("amountCommitment", datum.amountCommitment, 32),
    adapterTag: normalizeHex("adapterTag", datum.adapterTag, 32),
    deadline: nonNegativeInteger("deadline", datum.deadline),
    circuitArtifactHash: normalizeHex("circuitArtifactHash", datum.circuitArtifactHash, 32),
    senderPkh: normalizeHex("senderPkh", datum.senderPkh, 28),
    operatorPkh: normalizeHex("operatorPkh", datum.operatorPkh, 28),
    oraclePublicKey: normalizeHex("oraclePublicKey", datum.oraclePublicKey, 32),
  };
}

export function validateReleaseAuthorizationBody(
  authorization: ReleaseAuthorizationBodyIn,
): ReleaseAuthorizationBodyIn {
  return {
    settlementDigest: normalizeHex("settlementDigest", authorization.settlementDigest, 32),
    midnightSettlementReceiptHash: normalizeHex(
      "midnightSettlementReceiptHash",
      authorization.midnightSettlementReceiptHash,
      32,
    ),
    authorizationExpiry: nonNegativeInteger(
      "authorizationExpiry",
      authorization.authorizationExpiry,
    ),
  };
}

export function validateReleaseAuthorization(
  authorization: ReleaseAuthorizationIn,
): ReleaseAuthorizationIn {
  return {
    ...validateReleaseAuthorizationBody(authorization),
    oracleSignature: normalizeHex("oracleSignature", authorization.oracleSignature, 64),
  };
}

export function escrowDatumCbor(input: EscrowDatumIn): string {
  const datum = validateEscrowDatum(input);
  return Data.to(
    new Constr(0, [
      datum.intentId,
      datum.payeeCommitment,
      datum.amountCommitment,
      datum.adapterTag,
      datum.deadline,
      datum.circuitArtifactHash,
      datum.senderPkh,
      datum.operatorPkh,
      datum.oraclePublicKey,
    ]),
  );
}

function expectConstr(name: string, value: unknown, index: number, fields: number): Constr<unknown> {
  if (!(value instanceof Constr) || value.index !== index || value.fields.length !== fields) {
    throw new Error(`${name} has an invalid Plutus constructor shape`);
  }
  return value as Constr<unknown>;
}

function expectHexField(name: string, value: unknown): string {
  if (typeof value !== "string") throw new Error(`${name} must be Plutus bytes`);
  return value;
}

function expectIntegerField(name: string, value: unknown): bigint {
  if (typeof value !== "bigint") throw new Error(`${name} must be a Plutus integer`);
  return value;
}

export function decodeEscrowDatumCbor(cbor: string): EscrowDatumIn {
  let decoded: unknown;
  try {
    decoded = Data.from(cbor);
  } catch (error) {
    throw new Error(`escrow datum is not valid CBOR: ${(error as Error).message}`);
  }
  const datum = expectConstr("escrow datum", decoded, 0, 9);
  return validateEscrowDatum({
    intentId: expectHexField("intentId", datum.fields[0]),
    payeeCommitment: expectHexField("payeeCommitment", datum.fields[1]),
    amountCommitment: expectHexField("amountCommitment", datum.fields[2]),
    adapterTag: expectHexField("adapterTag", datum.fields[3]),
    deadline: expectIntegerField("deadline", datum.fields[4]),
    circuitArtifactHash: expectHexField("circuitArtifactHash", datum.fields[5]),
    senderPkh: expectHexField("senderPkh", datum.fields[6]),
    operatorPkh: expectHexField("operatorPkh", datum.fields[7]),
    oraclePublicKey: expectHexField("oraclePublicKey", datum.fields[8]),
  });
}

export function releaseAuthorizationMessageCbor(
  datumInput: EscrowDatumIn,
  outRefInput: EscrowOutRef,
  authorizationInput: ReleaseAuthorizationBodyIn,
): string {
  const datum = validateEscrowDatum(datumInput);
  const outRef = validateOutRef(outRefInput);
  const authorization = validateReleaseAuthorizationBody(authorizationInput);
  return Data.to(
    new Constr(0, [
      RELEASE_DOMAIN_SEPARATOR,
      datum.intentId,
      datum.payeeCommitment,
      datum.amountCommitment,
      datum.adapterTag,
      datum.deadline,
      datum.circuitArtifactHash,
      datum.senderPkh,
      datum.operatorPkh,
      datum.oraclePublicKey,
      outRef.txHash,
      BigInt(outRef.outputIndex),
      authorization.settlementDigest,
      authorization.midnightSettlementReceiptHash,
      authorization.authorizationExpiry,
    ]),
  );
}

export function releaseRedeemerCbor(input: ReleaseAuthorizationIn): string {
  const authorization = validateReleaseAuthorization(input);
  return Data.to(
    new Constr(0, [
      new Constr(0, [
        authorization.settlementDigest,
        authorization.midnightSettlementReceiptHash,
        authorization.authorizationExpiry,
        authorization.oracleSignature,
      ]),
    ]),
  );
}

/** @deprecated Use releaseRedeemerCbor; release now requires an authorization payload. */
export const RELEASE_REDEEMER = releaseRedeemerCbor;
export const REFUND_REDEEMER = Data.to(new Constr(1, []));

export function paymentPkhFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const pkh = details.paymentCredential?.hash;
  if (!pkh || details.paymentCredential?.type !== "Key") {
    throw new Error("address has no payment verification-key credential");
  }
  return normalizeHex("payment credential hash", pkh, 28);
}

export function paymentAddressFromPkh(network: Network, pkh: string): string {
  return credentialToAddress(network, keyHashToCredential(normalizeHex("payment key hash", pkh, 28)));
}

export function posixTimeToNumber(name: string, value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} must fit in a non-negative JavaScript safe integer`);
  }
  return Number(value);
}

export async function resolveEscrowUtxo(
  lucid: AppLucid,
  outRefInput: EscrowOutRef,
): Promise<ResolvedEscrowUtxo> {
  const network = lucid.config().network;
  if (!network) throw new Error("Lucid network is not configured");
  const outRef = validateOutRef(outRefInput);
  const scriptAddress = escrowScriptAddress(network);
  const utxos = await lucid.utxosByOutRef([outRef]);
  if (utxos.length !== 1) throw new Error("escrow UTxO was not found or was not unique");
  const utxo = utxos[0];
  if (utxo.address !== scriptAddress) throw new Error("target UTxO is not locked by the escrow script");
  if (!utxo.datum || utxo.datumHash) throw new Error("escrow UTxO must contain an inline datum");
  if (Object.keys(utxo.assets).length === 0) throw new Error("escrow UTxO has an empty asset bundle");
  const datum = decodeEscrowDatumCbor(utxo.datum);
  return {
    utxo,
    datum,
    scriptAddress,
    senderAddress: paymentAddressFromPkh(network, datum.senderPkh),
    operatorAddress: paymentAddressFromPkh(network, datum.operatorPkh),
  };
}

/** Resolve and validate the target UTxO, then return the exact bytes the oracle must sign. */
export async function releaseAuthorizationMessageForUtxo(
  lucid: AppLucid,
  outRef: EscrowOutRef,
  authorization: ReleaseAuthorizationBodyIn,
): Promise<string> {
  const resolved = await resolveEscrowUtxo(lucid, outRef);
  return releaseAuthorizationMessageCbor(resolved.datum, outRef, authorization);
}
