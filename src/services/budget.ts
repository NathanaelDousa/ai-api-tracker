import type { GlobalSettings } from "./types";

export function providerBudget(settings: GlobalSettings, key: keyof GlobalSettings): number {
  const value = Number(settings[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
