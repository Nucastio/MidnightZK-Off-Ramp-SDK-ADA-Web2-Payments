import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDoubleCborEncoding,
  CBOREncodingLevel,
  validatorToAddress,
  getAddressDetails,
} from "@lucid-evolution/utils";
import { Constr, Data, type Network, type Script } from "@lucid-evolution/lucid";

const _here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BLUEPRINT_PATH = join(_here, "../../../cardano/escrow/plutus.json");

export interface BlueprintJson {
  preamble: { plutusVersion: string };
  validators: Array<{ title: string; compiledCode?: string }>;
}

export function loadEscrowBlueprint(blueprintPath?: string): BlueprintJson {
  const fromEnv = process.env.OFFRAMP_ESCROW_BLUEPRINT?.trim();
  const path =
    blueprintPath ??
    (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BLUEPRINT_PATH);
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

export interface EscrowDatumIn {
  intentId: string;        // 64-hex
  payeeCommitment: string; // 64-hex
  amountCommitment: string;// 64-hex
  adapterTag: string;      // 64-hex
  deadline: bigint;        // POSIX seconds
  vkHash: string;          // 64-hex
  senderPkh: string;       // 56-hex blake2b224 of payment pubkey
  operatorPkh: string;     // 56-hex
}

function hex(s: string): string {
  return s.replace(/^0x/i, "").toLowerCase();
}

export function escrowDatumCbor(d: EscrowDatumIn): string {
  // Constructor 0 with 8 fields in declaration order (must match validators/escrow.ak `EscrowDatum`).
  const datum = new Constr(0, [
    hex(d.intentId),
    hex(d.payeeCommitment),
    hex(d.amountCommitment),
    hex(d.adapterTag),
    d.deadline,
    hex(d.vkHash),
    hex(d.senderPkh),
    hex(d.operatorPkh),
  ]);
  return Data.to(datum);
}

// EscrowAction = Release(0) | Refund(1) — empty constructor data.
export const RELEASE_REDEEMER = Data.to(new Constr(0, []));
export const REFUND_REDEEMER = Data.to(new Constr(1, []));

export function paymentPkhFromAddress(addressBech32: string): string {
  const details = getAddressDetails(addressBech32);
  const pkh = details.paymentCredential?.hash;
  if (!pkh) throw new Error("address has no payment credential hash");
  return pkh;
}
