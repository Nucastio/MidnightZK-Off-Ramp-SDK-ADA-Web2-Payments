import { createHash, timingSafeEqual } from "node:crypto";
import type {
  RailAdapterHealth,
  RailCapabilities,
  RailId,
  RailMode,
  RailProviderStatus,
} from "../types.js";

export interface AdapterDependencies {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface AdapterRuntime {
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
  now: () => number;
  mode: RailMode;
}

export function adapterRuntime(deps: AdapterDependencies = {}): AdapterRuntime {
  const env = deps.env ?? process.env;
  const rawMode = (env.RAIL_ADAPTER_MODE ?? "mock").toLowerCase();
  if (rawMode !== "mock" && rawMode !== "sandbox") {
    throw new Error(`RAIL_ADAPTER_MODE must be mock or sandbox, received ${rawMode}`);
  }
  return {
    env,
    fetch: deps.fetch ?? globalThis.fetch,
    now: deps.now ?? Date.now,
    mode: rawMode,
  };
}

export function missingEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => !env[key]?.trim());
}

export function assertConfigured(adapter: RailId, missing: string[]): void {
  if (missing.length > 0) {
    throw new Error(`${adapter} sandbox is not configured; missing ${missing.join(", ")}`);
  }
}

export function adapterHealth(input: {
  adapter: RailId;
  mode: RailMode;
  missing: string[];
  capabilities: RailCapabilities;
}): RailAdapterHealth {
  return {
    adapter: input.adapter,
    requestedMode: input.mode,
    effectiveMode: input.mode,
    ready: input.mode === "mock" || input.missing.length === 0,
    configured: input.mode === "mock" || input.missing.length === 0,
    missingEnv: [...input.missing],
    capabilities: input.capabilities,
  };
}

/** RFC 4122-shaped, stable UUID derived from provider namespace and intent ID. */
export function deterministicUuid(namespace: string, intentId: string): string {
  const bytes = createHash("sha256").update(`${namespace}:${intentId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function bytes(input: string | Uint8Array): Buffer {
  return typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
}

export function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function fetchWithTimeout(
  runtime: AdapterRuntime,
  url: string,
  init: RequestInit = {},
  timeoutMs = Number(runtime.env.RAIL_HTTP_TIMEOUT_MS ?? "15000"),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await runtime.fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`rail request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function responseJson<T>(provider: RailId, response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} HTTP ${response.status}: ${redactProviderError(text)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
}

function redactProviderError(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/Client\s+\S+\s+\S+/gi, "Client [REDACTED]")
    .slice(0, 500);
}

export function normalizeTerminalStatus(
  state: string,
  settled: readonly string[],
  failed: readonly string[],
  submitted: readonly string[] = [],
): RailProviderStatus {
  const normalized = state.toLowerCase();
  if (settled.includes(normalized)) return "SETTLED";
  if (failed.includes(normalized)) return "FAILED";
  if (submitted.includes(normalized)) return "SUBMITTED";
  return "PROCESSING";
}
