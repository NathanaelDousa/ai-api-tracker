import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
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
    // Log the body so we can see what xAI actually returns if it's not what we expect.
    const body = await response.text().catch(() => "");
    streamDeck.logger.warn(`[Grok] /v1/api-key ${response.status}: ${body.slice(0, 200)}`);
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  const raw = await response.json() as GrokKeyResponse;
  streamDeck.logger.info(`[Grok] raw response: ${JSON.stringify(raw).slice(0, 200)}`);

  // Normalise — flatten nested .data if present.
  const payload = raw.data ?? raw;
  const usage     = payload.usage_usd     ?? 0;
  const apiLimit  = payload.limit_usd     ?? null;
  const apiLeft   = payload.remaining_usd ?? null;

  const total     = apiLimit != null ? apiLimit : budget;
  const remaining = apiLeft  != null ? apiLeft
    : apiLimit               != null ? Math.max(0, apiLimit - usage)
    : Math.max(0, budget - usage);

  streamDeck.logger.info(
    `[Grok] usage=$${usage.toFixed(4)} limit=${apiLimit ?? "none"} remaining=$${remaining.toFixed(4)}`,
  );

  const trend = recordAndGetTrend("grok:usd", usage);

  // Grok has no daily breakdown — show total spend as the primary cost figure.
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
