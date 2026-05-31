import fs from "node:fs";
import path from "node:path";
import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
import { normalizeSecret } from "./keyUtils";

// GET /user/balance — returns pre-paid credit balance.
// DeepSeek doesn't expose a per-day spend history endpoint, so we show
// the remaining credit balance rather than monthly spend.
// Currency may be CNY or USD; we normalise both to USD.

const BASE_URL = "https://api.deepseek.com";

// --- Live exchange rate cache (frankfurter.app — free, no API key) ----------
const RATE_TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once per day
let cnyRateCache: { rate: number; fetchedAt: number } | null = null;

async function getCnyToUsd(manualRate: unknown): Promise<number> {
  const configuredRate = Number(manualRate);
  if (Number.isFinite(configuredRate) && configuredRate > 0) {
    return configuredRate;
  }

  if (cnyRateCache && Date.now() - cnyRateCache.fetchedAt < RATE_TTL_MS) {
    return cnyRateCache.rate;
  }
  try {
    const res  = await fetch(
      "https://api.frankfurter.app/latest?from=CNY&to=USD",
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { rates: { USD: number } };
    const rate = json.rates.USD;
    if (typeof rate === "number" && rate > 0) {
      cnyRateCache = { rate, fetchedAt: Date.now() };
      streamDeck.logger.info(`[DeepSeek] CNY→USD rate refreshed: ${rate}`);
      return rate;
    }
  } catch (err: unknown) {
    streamDeck.logger.warn(`[DeepSeek] exchange rate fetch failed: ${String(err)}`);
  }
  // Fallback to last cached value or a hardcoded approximate.
  return cnyRateCache?.rate ?? 0.138;
}

// ── Local monthly-spend tracker ──────────────────────────────────────────────
//
// DeepSeek only exposes a live credit balance — there's no API for historical
// spend.  We track spend ourselves by recording balance deltas:
//   • balance went DOWN  → the difference is spending, add it to the month total
//   • balance went UP    → the user topped up; update the baseline but don't add
//   • month changed      → reset the accumulator for the new month
//
// Data is persisted in deepseek-spend.json next to the plugin bundle so it
// survives plugin restarts.  Note: spend while the plugin is not running is
// captured on the next startup (one reading is always missed for top-ups that
// happen while the plugin is down, but that's an inherent limitation of polling).

const STORE_PATH = path.join(process.cwd(), "deepseek-spend.json");

interface SpendStore {
  month:          string;        // "YYYY-MM" UTC
  monthlySpend:   number;
  lastBalance:    number;        // -1 = uninitialised
  // Day-level fields (added in v1.1 — may be absent in older store files)
  todayDate?:     string;        // "YYYY-MM-DD" UTC
  todaySpend?:    number;        // spend accumulated today
  yesterdaySpend?: number | null; // yesterday's final spend
}

function loadSpendStore(): SpendStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as SpendStore;
  } catch {
    return { month: "", monthlySpend: 0, lastBalance: -1 };
  }
}

function saveSpendStore(store: SpendStore): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), "utf8");
  } catch (err: unknown) {
    streamDeck.logger.warn(`[DeepSeek] could not save spend store: ${String(err)}`);
  }
}

function utcMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function previousUtcDay(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

interface SpendResult {
  monthlySpend: number;
  dailySpend:   number;
  trend:        number | undefined;
}

/**
 * Record the latest balance reading. Returns monthly spend, today's spend,
 * and the trend delta (today - yesterday). Trend is undefined until two
 * consecutive days of data exist.
 */
function recordBalance(currentBalance: number): SpendResult {
  const month = utcMonth();
  const today = utcDay();
  let store   = loadSpendStore();

  // New calendar month: wipe the slate clean.
  if (store.month !== month) {
    store = { month, monthlySpend: 0, lastBalance: currentBalance, todayDate: today, todaySpend: 0, yesterdaySpend: null };
    saveSpendStore(store);
    streamDeck.logger.info(`[DeepSeek] new month (${month}), spend reset`);
    return { monthlySpend: 0, dailySpend: 0, trend: undefined };
  }

  // First ever reading.
  if (store.lastBalance < 0) {
    store = { ...store, lastBalance: currentBalance, todayDate: today, todaySpend: 0, yesterdaySpend: null };
    saveSpendStore(store);
    return { monthlySpend: 0, dailySpend: 0, trend: undefined };
  }

  // Restore day-level fields (may be absent in files written before v1.1).
  let todaySpend      = store.todaySpend     ?? 0;
  let yesterdaySpend  = store.yesterdaySpend ?? null;
  const storedDay     = store.todayDate      ?? today;

  // New calendar day: promote today -> yesterday when readings are consecutive.
  if (storedDay < today) {
    yesterdaySpend = storedDay === previousUtcDay() ? todaySpend : null;
    todaySpend     = 0;
  } else if (storedDay > today) {
    yesterdaySpend = null;
    todaySpend     = 0;
  }

  const delta        = store.lastBalance - currentBalance;
  let   monthlySpend = store.monthlySpend ?? 0;

  if (delta > 0.0001) {
    monthlySpend += delta;
    todaySpend   += delta;
    streamDeck.logger.info(
      `[DeepSeek] spent $${delta.toFixed(4)} | today $${todaySpend.toFixed(4)} | month $${monthlySpend.toFixed(4)}`,
    );
  } else if (currentBalance > store.lastBalance + 0.0001) {
    streamDeck.logger.info(`[DeepSeek] top-up $${(currentBalance - store.lastBalance).toFixed(4)}, baseline updated`);
  }

  saveSpendStore({ month, monthlySpend, lastBalance: currentBalance, todayDate: today, todaySpend, yesterdaySpend });

  const trend = yesterdaySpend != null ? todaySpend - yesterdaySpend : undefined;
  return { monthlySpend, dailySpend: todaySpend, trend };
}

// ---------------------------------------------------------------------------

interface BalanceInfo {
  currency:          string;
  total_balance:     string;
  granted_balance:   string;
  topped_up_balance: string;
}

interface BalanceResponse {
  is_available:  boolean;
  balance_infos: BalanceInfo[];
}

export async function fetchDeepSeekUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.deepseekApiKey);
  const budget = providerBudget(gs, "deepseekMonthlyBudget");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  const data = await fetchBalance(apiKey);
  const hasCny = data.balance_infos.some(b => b.currency.toUpperCase() === "CNY");
  const cnyToUsd = hasCny ? await getCnyToUsd(gs.deepseekCnyToUsdRate) : 1;
  const remaining = sumBalanceInfosUsd(data.balance_infos, cnyToUsd);

  if (!data.is_available) {
    streamDeck.logger.warn("[DeepSeek] balance endpoint reports account unavailable");
  }

  // Record this reading and get accumulated spend/trend values.
  const spend = recordBalance(remaining);

  streamDeck.logger.info(
    `[DeepSeek] remaining=$${remaining.toFixed(4)} monthlySpend=$${spend.monthlySpend.toFixed(4)} ` +
    `dailySpend=$${spend.dailySpend.toFixed(4)} (rate=${cnyToUsd})`,
  );

  // When no budget is configured we use the balance itself as the "total"
  // so the tile shows "$ X.XX left" rather than the no-budget path.
  const total = budget > 0 ? budget : remaining;

  return {
    dailyTokens:     0,
    dailyCost:       round3(spend.dailySpend),
    monthlyCost:     round2(spend.monthlySpend),
    trend:           spend.trend == null ? undefined : round3(spend.trend),
    isEstimate:      hasCny ? true : undefined,
    budgetTotal:     total,
    budgetRemaining: budget > 0 ? Math.min(remaining, budget) : remaining,
    lastUpdated:     Date.now(),
  };
}

export function sumBalanceInfosUsd(balanceInfos: BalanceInfo[], cnyToUsd: number): number {
  let total = 0;

  for (const info of balanceInfos) {
    const amount = parseFloat(info.total_balance) || 0;
    switch (info.currency.toUpperCase()) {
      case "USD":
        total += amount;
        break;
      case "CNY":
        total += amount * cnyToUsd;
        break;
      default:
        streamDeck.logger.warn(`[DeepSeek] unsupported balance currency: ${info.currency}`);
        break;
    }
  }

  return total;
}

async function fetchBalance(apiKey: string): Promise<BalanceResponse> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    throw {
      kind:    "network-error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies FetchError;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw { kind: "bad-api-key", status: response.status } satisfies FetchError;
    }
    if (response.status === 429) {
      const ra = parseInt(response.headers.get("retry-after") ?? "", 10);
      throw { kind: "rate-limited", retryAfter: Number.isNaN(ra) ? undefined : ra } satisfies FetchError;
    }
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  return response.json() as Promise<BalanceResponse>;
}

function round2(n: number): number { return Math.round(n * 100)  / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
