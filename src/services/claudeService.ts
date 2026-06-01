import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
import { isClaudeAdminKey, normalizeSecret } from "./keyUtils";
import { recordAndGetTrend } from "./trendStore";

// GET /v1/organizations/cost_report — requires an Admin API key.
// Amounts returned as decimal strings in cents (divide by 100 for USD).
// Only available for organization accounts (not individual accounts).

const BASE_URL    = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const MAX_PAGES   = 5;
const USER_AGENT  = "AI API Tracker/1.0.0 (Stream Deck plugin)";

interface CostResult {
  amount:   string;
  currency: string;
}

interface CostBucket {
  starting_at: string;
  ending_at:   string;
  results:     CostResult[];
}

interface CostReportResponse {
  data:      CostBucket[];
  has_more:  boolean;
  next_page: string | null;
}

interface UsageResult {
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
}

interface UsageBucket {
  starting_at: string;
  ending_at:   string;
  results:     UsageResult[];
}

interface UsageReportResponse {
  data:      UsageBucket[];
  has_more:  boolean;
  next_page: string | null;
}

export async function fetchClaudeUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.claudeApiKey);
  const budget = providerBudget(gs, "claudeMonthlyBudget");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  // Usage API requires an Admin key (sk-ant-admin...).
  // Regular API keys (sk-ant-api...) don't have access — throw immediately
  // so we don't make an API call that will always 401.
  if (!isClaudeAdminKey(apiKey)) {
    throw { kind: "admin-key-required" } satisfies FetchError;
  }

  const now        = new Date();
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startingAt   = new Date(startOfMonth).toISOString();
  // Cost report validates at day granularity — ensure end is on a different
  // calendar date from start (same fix as OpenAI costs endpoint).
  const endMs      = Math.max(now.getTime(), startOfMonth + 86_400_000);
  const endingAt   = new Date(endMs).toISOString();
  const todayStr   = now.toISOString().slice(0, 10);

  const costReport = await fetchCostReport(apiKey, startingAt, endingAt, todayStr);
  const usageReport = await fetchMessagesUsageSafely(apiKey, startingAt, endingAt, todayStr);

  streamDeck.logger.info(
    `[Claude] costPages=${costReport.pages} usagePages=${usageReport.pages} monthlyCost=${costReport.monthlyCost.toFixed(4)} dailyCost=${costReport.dailyCost.toFixed(4)} dailyTokens=${usageReport.dailyTokens}`,
  );

  const trend = recordAndGetTrend("claude", round3(costReport.dailyCost));

  return {
    dailyTokens:     usageReport.dailyTokens,
    dailyCost:       round3(costReport.dailyCost),
    monthlyCost:     round2(costReport.monthlyCost),
    trend,
    budgetTotal:     budget,
    budgetRemaining: round2(budget - costReport.monthlyCost),
    lastUpdated:     Date.now(),
  };
}

async function fetchCostReport(
  apiKey: string,
  startingAt: string,
  endingAt: string,
  todayStr: string,
): Promise<{ monthlyCost: number; dailyCost: number; pages: number }> {
  let monthlyCost = 0;
  let dailyCost = 0;
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const url =
      `${BASE_URL}/v1/organizations/cost_report` +
      `?starting_at=${encodeURIComponent(startingAt)}` +
      `&ending_at=${encodeURIComponent(endingAt)}` +
      `&bucket_width=1d` +
      `&limit=31` +
      (pageToken ? `&page=${encodeURIComponent(pageToken)}` : "");

    const page = await fetchPage(apiKey, url);

    for (const bucket of page.data) {
      const bucketDate = bucket.starting_at.slice(0, 10);
      for (const result of (bucket.results ?? [])) {
        const dollars = (parseFloat(result.amount) || 0) / 100;
        monthlyCost += dollars;
        if (bucketDate === todayStr) {
          dailyCost += dollars;
        }
      }
    }

    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return { monthlyCost, dailyCost, pages };
}

async function fetchMessagesUsageSafely(
  apiKey: string,
  startingAt: string,
  endingAt: string,
  todayStr: string,
): Promise<{ dailyTokens: number; pages: number }> {
  try {
    return await fetchMessagesUsage(apiKey, startingAt, endingAt, todayStr);
  } catch (err: unknown) {
    streamDeck.logger.warn(`[Claude] usage_report unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return { dailyTokens: 0, pages: 0 };
  }
}

async function fetchMessagesUsage(
  apiKey: string,
  startingAt: string,
  endingAt: string,
  todayStr: string,
): Promise<{ dailyTokens: number; pages: number }> {
  let dailyTokens = 0;
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const url =
      `${BASE_URL}/v1/organizations/usage_report/messages` +
      `?starting_at=${encodeURIComponent(startingAt)}` +
      `&ending_at=${encodeURIComponent(endingAt)}` +
      `&bucket_width=1d` +
      `&limit=31` +
      (pageToken ? `&page=${encodeURIComponent(pageToken)}` : "");

    const page = await fetchUsagePage(apiKey, url);
    for (const bucket of page.data) {
      const bucketDate = bucket.starting_at.slice(0, 10);
      if (bucketDate !== todayStr) continue;
      for (const result of (bucket.results ?? [])) {
        dailyTokens += positive(result.uncached_input_tokens);
        dailyTokens += positive(result.cache_read_input_tokens);
        dailyTokens += positive(result.output_tokens);
        dailyTokens += positive(result.cache_creation?.ephemeral_1h_input_tokens);
        dailyTokens += positive(result.cache_creation?.ephemeral_5m_input_tokens);
      }
    }

    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return { dailyTokens, pages };
}

async function fetchPage(apiKey: string, url: string): Promise<CostReportResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": API_VERSION,
        "User-Agent":        USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
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

  return response.json() as Promise<CostReportResponse>;
}

async function fetchUsagePage(apiKey: string, url: string): Promise<UsageReportResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": API_VERSION,
        "User-Agent":        USER_AGENT,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<UsageReportResponse>;
}

function positive(n: unknown): number {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function round2(n: number): number { return Math.round(n * 100)  / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
