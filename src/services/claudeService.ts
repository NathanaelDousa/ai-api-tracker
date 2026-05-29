import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";

// GET /v1/organizations/cost_report — requires an Admin API key.
// Amounts returned as decimal strings in cents (divide by 100 for USD).
// Only available for organization accounts (not individual accounts).

const BASE_URL    = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const MAX_PAGES   = 5;

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

export async function fetchClaudeUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = gs.claudeApiKey;
  const budget = Math.max(0, Number(gs.claudeMonthlyBudget ?? gs.monthlyBudget) || 0);

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  // Usage API requires an Admin key (sk-ant-admin...).
  // Regular API keys (sk-ant-api...) don't have access — throw immediately
  // so we don't make an API call that will always 401.
  if (!apiKey.startsWith("sk-ant-admin")) {
    throw { kind: "coming-soon" } satisfies FetchError;
  }

  const now        = new Date();
  const startingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const endingAt   = now.toISOString();
  const todayStr   = now.toISOString().slice(0, 10);

  let monthlyCost = 0;
  let dailyCost   = 0;
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const url =
      `${BASE_URL}/v1/organizations/cost_report` +
      `?starting_at=${encodeURIComponent(startingAt)}` +
      `&ending_at=${encodeURIComponent(endingAt)}` +
      `&bucket_width=1d` +
      (pageToken ? `&page=${encodeURIComponent(pageToken)}` : "");

    const page = await fetchPage(apiKey, url);

    for (const bucket of page.data) {
      const bucketDate = bucket.starting_at.slice(0, 10);
      for (const result of (bucket.results ?? [])) {
        const dollars = parseFloat(result.amount) / 100;
        monthlyCost += dollars;
        if (bucketDate === todayStr) {
          dailyCost += dollars;
        }
      }
    }

    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  streamDeck.logger.info(
    `[Claude] pages=${pages} monthlyCost=${monthlyCost.toFixed(4)} dailyCost=${dailyCost.toFixed(4)}`,
  );

  return {
    dailyTokens:     0,
    dailyCost:       round3(dailyCost),
    monthlyCost:     round2(monthlyCost),
    budgetTotal:     budget,
    budgetRemaining: round2(budget - monthlyCost),
    lastUpdated:     Date.now(),
  };
}

async function fetchPage(apiKey: string, url: string): Promise<CostReportResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": API_VERSION,
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

function round2(n: number): number { return Math.round(n * 100)  / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
