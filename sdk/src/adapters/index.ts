import type { RailAdapter, RailId } from "../types.ts";
import { cashappAdapter } from "./cashapp.ts";
import { wiseAdapter } from "./wise.ts";
import { revolutAdapter } from "./revolut.ts";

export const adapters: Record<RailId, RailAdapter> = {
  cashapp: cashappAdapter,
  wise: wiseAdapter,
  revolut: revolutAdapter,
};

export function getAdapter(id: RailId): RailAdapter {
  const a = adapters[id];
  if (!a) throw new Error(`Unknown rail adapter: ${id}`);
  return a;
}

export { cashappAdapter, wiseAdapter, revolutAdapter };
