import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
import { normalizeSecret } from "./keyUtils";
import { recordAndGetTrend } from "./trendStore";

// GET /api/v1/auth/key — returns credit balance and total usage.
// OpenRouter uses a credit wallet model: you buy credits, spend them across
// any supported model (GPT-4o, Claude, Llama, Mistral, …), one API key.

const BASE_URL = "https://openrouter.ai";

interface OpenRouterKeyResponse {
  data: {
    label:        string;
    usage:        number;        // total credits used (USD)
    limit:        number | null; // credit limit; null = no hard limit
    is_free_tier: boolean;
    rate_limit: {
      requests: number;
      interval: string;
    };
  };
}

export async function fetchOpenRouterUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.openrouterApiKey);
  const budget = providerBudget(gs, "openrouterMonthlyBudget");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/v1/auth/key`, {
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

  const { data } = await response.json() as OpenRouterKeyResponse;

  const usage     = data.usage  ?? 0;
  const apiLimit  = data.limit;

  // Prefer the API-reported credit limit as the budget ceiling.
  // Fall back to user-configured budget if no hard limit is set.
  const total     = apiLimit != null ? apiLimit : budget;
  const remaining = apiLimit != null ? Math.max(0, apiLimit - usage) : Math.max(0, budget - usage);

  streamDeck.logger.info(
    `[OpenRouter] usage=$${usage.toFixed(4)} limit=${apiLimit ?? "none"} remaining=$${remaining.toFixed(4)}`,
  );

  const trend = recordAndGetTrend("openrouter:usd", usage);

  // OpenRouter has no daily breakdown — show total spend as the primary cost
  // figure so the tile reads "X.XX used" rather than "$0.00 today / $X.XX /mo".
  return {
    dailyTokens:     0,
    dailyCost:       round2(usage),
    monthlyCost:     total > 0 ? round2(usage) : undefined,
    trend,
    budgetTotal:     total,
    budgetRemaining: round2(remaining),
    lastUpdated:     Date.now(),
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
