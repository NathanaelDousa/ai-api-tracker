import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { configuredBalance, providerBudget } from "./budget";
import { normalizeSecret } from "./keyUtils";
import { recordAndGetTrend } from "./trendStore";

// GET /v1/api-key — returns credit balance and usage for the authenticated key.
// xAI uses a credit wallet: buy credits, spend across Grok models.

const BASE_URL = "https://api.x.ai";

interface GrokKeyResponse {
  /** Credits used so far (USD) */
  usage_usd?: number;
  /** Total credits purchased / wallet limit (USD) */
  limit_usd?: number;
  /** Remaining credits (USD) — may be present directly */
  remaining_usd?: number;
  /** Some versions nest data under a key */
  data?: {
    usage_usd?:     number;
    limit_usd?:     number;
    remaining_usd?: number;
  };
}

export async function fetchGrokUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.grokApiKey);
  const budget = providerBudget(gs, "grokMonthlyBudget");
  const dashboardBalance = configuredBalance(gs, "grokCreditBalance");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v1/api-key`, {
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
    streamDeck.logger.warn(`[Grok] /v1/api-key returned HTTP ${response.status}`);
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  const raw = await response.json() as GrokKeyResponse;

  // Normalise — flatten nested .data if present.
  const payload = raw.data ?? raw;
  const usage     = payload.usage_usd     ?? 0;
  const apiLimit  = payload.limit_usd     ?? null;
  const apiLeft   = payload.remaining_usd ?? null;

  const total     = apiLimit != null ? apiLimit : budget;
  const remaining = apiLeft  != null ? apiLeft
    : apiLimit               != null ? Math.max(0, apiLimit - usage)
    : dashboardBalance       != null ? dashboardBalance
    : Math.max(0, budget - usage);
  const hasBalance = apiLeft != null || dashboardBalance != null;

  streamDeck.logger.info(
    `[Grok] usage=$${usage.toFixed(4)} limit=${apiLimit ?? "none"} remaining=$${remaining.toFixed(4)}`,
  );

  const trend = recordAndGetTrend("grok:usd", usage);

  // Grok has no daily/monthly breakdown here; usage is total key spend.
  return {
    dailyTokens:     0,
    dailyCost:       0,
    dailyCostUnavailable: true,
    monthlyCost:     round2(usage),
    spendPeriod:     "total",
    balanceRemaining: budget > 0 || apiLimit != null || !hasBalance ? undefined : round2(remaining),
    trend,
    budgetTotal:     total,
    budgetRemaining: round2(remaining),
    lastUpdated:     Date.now(),
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
