import type { RailAdapter, RailAdapterHealth, RailId } from "../types.js";
import { cashappAdapter, createCashAppAdapter } from "./cashapp.js";
import { wiseAdapter, createWiseAdapter } from "./wise.js";
import { revolutAdapter, createRevolutAdapter } from "./revolut.js";
import {
  createDeterministicMockAdapter,
  mockCashAppAdapter,
  mockWiseAdapter,
  mockRevolutAdapter,
} from "./mock.js";

export const adapters: Record<RailId, RailAdapter> = {
  cashapp: cashappAdapter,
  wise: wiseAdapter,
  revolut: revolutAdapter,
};

export function getAdapter(id: RailId): RailAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`Unknown rail adapter: ${id}`);
  return adapter;
}

export function adapterHealth(): Record<RailId, RailAdapterHealth> {
  return {
    cashapp: adapters.cashapp.health(),
    wise: adapters.wise.health(),
    revolut: adapters.revolut.health(),
  };
}

export {
  cashappAdapter,
  wiseAdapter,
  revolutAdapter,
  createCashAppAdapter,
  createWiseAdapter,
  createRevolutAdapter,
  createDeterministicMockAdapter,
  mockCashAppAdapter,
  mockWiseAdapter,
  mockRevolutAdapter,
};
export type { AdapterDependencies } from "./common.js";
