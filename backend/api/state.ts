import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { IntentRecord } from "../../sdk/src/types.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
mkdirSync(DATA_DIR, { recursive: true });

const INTENTS_PATH = join(DATA_DIR, "intents.json");

interface State {
  intents: Record<string, IntentRecord>;
}

function load(): State {
  if (!existsSync(INTENTS_PATH)) return { intents: {} };
  return JSON.parse(readFileSync(INTENTS_PATH, "utf8"), (_, v) => {
    if (typeof v === "string" && /^\d+n$/.test(v)) return BigInt(v.slice(0, -1));
    return v;
  });
}

function save(s: State): void {
  const replacer = (_: string, v: unknown) =>
    typeof v === "bigint" ? `${v.toString()}n` : v;
  writeFileSync(INTENTS_PATH, JSON.stringify(s, replacer, 2), "utf8");
}

let state: State = load();

export function listIntents(): IntentRecord[] {
  return Object.values(state.intents).sort((a, b) => b.createdAt - a.createdAt);
}

export function getIntent(id: string): IntentRecord | undefined {
  return state.intents[id];
}

export function upsertIntent(rec: IntentRecord): IntentRecord {
  state.intents[rec.intentId] = { ...rec, updatedAt: Date.now() };
  save(state);
  return state.intents[rec.intentId];
}

export function patchIntent(id: string, patch: Partial<IntentRecord>): IntentRecord {
  const cur = state.intents[id];
  if (!cur) throw new Error("intent not found: " + id);
  state.intents[id] = { ...cur, ...patch, updatedAt: Date.now() };
  save(state);
  return state.intents[id];
}

export function appendError(id: string, msg: string): IntentRecord {
  const cur = state.intents[id];
  if (!cur) throw new Error("intent not found: " + id);
  cur.errors = [...(cur.errors ?? []), msg];
  cur.updatedAt = Date.now();
  save(state);
  return cur;
}

export interface TestReportRecord {
  ranAt: number;
  totalRuns: number;
  perRail: Record<string, {
    runs: number;
    successes: number;
    failures: number;
    successRate: number;
    avgProveMs: number;
    avgVerifyMs: number;
    avgSubmitMs: number;
    avgAttestMs: number;
  }>;
  overallSuccessRate: number;
  avgProveMs: number;
  avgVerifyMs: number;
  failures: { adapter: string; reason: string }[];
}

const REPORT_PATH = join(DATA_DIR, "testing-report.json");

export function saveReport(r: TestReportRecord): void {
  writeFileSync(REPORT_PATH, JSON.stringify(r, null, 2), "utf8");
}

export function loadReport(): TestReportRecord | null {
  if (!existsSync(REPORT_PATH)) return null;
  return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}
