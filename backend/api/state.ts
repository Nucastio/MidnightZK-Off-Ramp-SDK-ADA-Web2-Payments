import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertTransition,
  deepRedact,
  type LifecycleState,
  type StoredIntentRecord,
} from "./lifecycle.ts";

const DATA_DIR = process.env.OFFRAMP_DATA_DIR ?? "data";
mkdirSync(DATA_DIR, { recursive: true });

const INTENTS_PATH = join(DATA_DIR, "intents.json");

interface State {
  intents: Record<string, StoredIntentRecord>;
}

function load(): State {
  if (!existsSync(INTENTS_PATH)) return { intents: {} };
  const parsed = JSON.parse(readFileSync(INTENTS_PATH, "utf8"), (_, v) => {
    if (typeof v === "string" && /^\d+n$/.test(v)) return BigInt(v.slice(0, -1));
    return v;
  }) as State;
  // Drop legacy records that predate the explicit lifecycle (no `state` field);
  // they cannot be safely resumed under the new transition rules.
  const intents: Record<string, StoredIntentRecord> = {};
  for (const [id, rec] of Object.entries(parsed.intents ?? {})) {
    if (rec && typeof rec === "object" && typeof (rec as StoredIntentRecord).state === "string") {
      intents[id] = rec as StoredIntentRecord;
    }
  }
  return { intents };
}

function save(s: State): void {
  const replacer = (_: string, v: unknown) =>
    typeof v === "bigint" ? `${v.toString()}n` : v;
  // Defense in depth: strip any sensitive key (payeeHandle / salts / raw
  // capability tokens / KYC tags) from the object graph before it reaches disk.
  const redacted: State = { intents: deepRedact(s.intents) };
  writeFileSync(INTENTS_PATH, JSON.stringify(redacted, replacer, 2), "utf8");
}

let state: State = load();

export function listIntents(): StoredIntentRecord[] {
  return Object.values(state.intents).sort((a, b) => b.createdAt - a.createdAt);
}

export function getIntent(id: string): StoredIntentRecord | undefined {
  return state.intents[id];
}

export function upsertIntent(rec: StoredIntentRecord): StoredIntentRecord {
  // Redact in memory too so no code path can later echo cleartext PII.
  state.intents[rec.intentId] = deepRedact({ ...rec, updatedAt: Date.now() });
  save(state);
  return state.intents[rec.intentId];
}

/**
 * Validated state transition: refuses anything not allowed by the lifecycle
 * table, appends a history event, applies `patch`, persists, and returns the
 * updated record.
 */
export function transitionIntent(
  id: string,
  to: LifecycleState,
  patch: Partial<StoredIntentRecord> = {},
): StoredIntentRecord {
  const cur = state.intents[id];
  if (!cur) throw new Error("intent not found: " + id);
  assertTransition(cur.state, to);
  const now = Date.now();
  const next: StoredIntentRecord = deepRedact({
    ...cur,
    ...patch,
    state: to,
    history: [...(cur.history ?? []), { from: cur.state, to, at: now }],
    updatedAt: now,
  });
  state.intents[id] = next;
  save(state);
  return next;
}

/** Patch without a state change (e.g. storing an authorization refresh). */
export function patchIntent(id: string, patch: Partial<StoredIntentRecord>): StoredIntentRecord {
  const cur = state.intents[id];
  if (!cur) throw new Error("intent not found: " + id);
  if (patch.state && patch.state !== cur.state) {
    throw new Error("patchIntent must not change lifecycle state; use transitionIntent");
  }
  state.intents[id] = deepRedact({ ...cur, ...patch, updatedAt: Date.now() });
  save(state);
  return state.intents[id];
}

export function appendError(id: string, msg: string): StoredIntentRecord {
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
