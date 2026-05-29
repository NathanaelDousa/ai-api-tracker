import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";

// GET /user/balance — returns pre-paid credit balance.
// DeepSeek doesn't expose a per-day spend history endpoint, so we show
// the remaining credit balance rather than monthly spend.
// Currency may be CNY or USD; we normalise both to USD.

const BASE_URL = "https://api.deepseek.com";

// --- Live exchange rate cache (frankfurter.app — free, no API key) ----------
const RATE_TTL_MS = 24 * 60 * 60 * 1000; // refresh at most once per day
let cnyRateCache: { rate: number; fetchedAt: number } | null = null;

async function getCnyToUsd(): Promise<number> {
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
  const apiKey = gs.deepseekApiKey;
  const budget = Math.max(0, Number(gs.deepseekMonthlyBudget ?? gs.monthlyBudget) || 0);

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  const [data, cnyToUsd] = await Promise.all([
    fetchBalance(apiKey),
    getCnyToUsd(),
  ]);

  const usd = data.balance_infos.find(b => b.currency === "USD");
  const cny = data.balance_infos.find(b => b.currency === "CNY");

  let remaining = 0;
  if (usd) {
    remaining = parseFloat(usd.total_balance) || 0;
  } else if (cny) {
    remaining = (parseFloat(cny.total_balance) || 0) * cnyToUsd;
  }

  streamDeck.logger.info(`[DeepSeek] remaining=$${remaining.toFixed(4)} (rate=${cnyToUsd})`);

  // When no budget is configured we use the balance itself as the "total"
  // so the tile shows "$ X.XX left" rather than the no-budget path.
  const total = budget > 0 ? budget : remaining;

  return {
    dailyTokens:     0,
    dailyCost:       0,
    budgetTotal:     total,
    budgetRemaining: budget > 0 ? Math.min(remaining, budget) : remaining,
    lastUpdated:     Date.now(),
  };
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
