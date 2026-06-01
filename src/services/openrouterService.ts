import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
import { normalizeSecret } from "./keyUtils";
import { recordAndGetTrend } from "./trendStore";

// GET /api/v1/credits returns account credits and total usage.
// GET /api/v1/key returns per-key usage periods and optional key limits.
// OpenRouter uses a credit wallet model: you buy credits, spend them across
// any supported model (GPT-4o, Claude, Llama, Mistral, …), one API key.

const BASE_URL = "https://openrouter.ai";

interface OpenRouterKeyResponse {
  data: {
    label:        string;
    usage:        number;        // total key usage (USD)
    usage_daily?: number;        // current UTC day usage
    usage_monthly?: number;      // current UTC month usage
    limit:        number | null; // key credit limit; null = no hard limit
    limit_remaining?: number | null;
    is_free_tier: boolean;
    rate_limit: {
      requests: number;
      interval: string;
    };
  };
}

interface OpenRouterCreditsResponse {
  data: {
    total_credits: number;
    total_usage: number;
  };
}

export async function fetchOpenRouterUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.openrouterApiKey);
  const budget = providerBudget(gs, "openrouterMonthlyBudget");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  const [credits, keyInfo] = await Promise.all([
    fetchJson<OpenRouterCreditsResponse>(apiKey, `${BASE_URL}/api/v1/credits`),
    fetchKeyInfoSafely(apiKey),
  ]);

  const totalCredits = positive(credits.data.total_credits);
  const totalUsage   = positive(credits.data.total_usage);
  const remaining    = Math.max(0, totalCredits - totalUsage);
  const monthlyUsage = keyInfo?.data.usage_monthly;
  const dailyUsage   = keyInfo?.data.usage_daily;
  const shownUsage   = monthlyUsage != null ? positive(monthlyUsage) : totalUsage;

  streamDeck.logger.info(
    `[OpenRouter] credits=$${totalCredits.toFixed(4)} totalUsage=$${totalUsage.toFixed(4)} ` +
    `monthly=$${shownUsage.toFixed(4)} remaining=$${remaining.toFixed(4)}`,
  );

  const trend = recordAndGetTrend("openrouter:usd", round2(dailyUsage ?? 0));

  return {
    dailyTokens:     0,
    dailyCost:       round2(dailyUsage ?? 0),
    dailyCostUnavailable: dailyUsage == null ? true : undefined,
    monthlyCost:     round2(shownUsage),
    spendPeriod:     monthlyUsage != null ? "month" : "total",
    balanceRemaining: budget > 0 ? undefined : round2(remaining),
    trend,
    budgetTotal:     budget,
    budgetRemaining: budget > 0 ? round2(budget - shownUsage) : 0,
    lastUpdated:     Date.now(),
  };
}

async function fetchKeyInfoSafely(apiKey: string): Promise<OpenRouterKeyResponse | null> {
  try {
    return await fetchJson<OpenRouterKeyResponse>(apiKey, `${BASE_URL}/api/v1/key`);
  } catch (err: unknown) {
    streamDeck.logger.warn(`[OpenRouter] key usage unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchJson<T>(apiKey: string, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
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
      throw { kind: "rate-limited" } satisfies FetchError;
    }
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  return response.json() as Promise<T>;
}

function positive(n: unknown): number {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
