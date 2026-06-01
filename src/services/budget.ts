import type { GlobalSettings } from "./types";

export function providerBudget(settings: GlobalSettings, key: keyof GlobalSettings): number {
  const value = Number(settings[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function configuredBalance(settings: GlobalSettings, key: keyof GlobalSettings): number | null {
  const raw = settings[key];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
