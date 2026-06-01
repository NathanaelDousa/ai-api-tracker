// ============================================================================
// Shared types for AI API Tracker - single source of truth.
// All provider services AND the action import from here.
// ============================================================================

// --------------------------------------------------------------------------
// Usage data returned by every provider's fetcher
// --------------------------------------------------------------------------

export interface UsageData {
  /** Total tokens consumed today (input + output) */
  dailyTokens: number;
  /** Estimated USD cost for today's usage */
  dailyCost: number;
  /** True when the provider does not expose a daily spend reading. */
  dailyCostUnavailable?: boolean;
  /** Month-to-date spend in USD, or total usage when spendPeriod is "total".
   *  Undefined when the provider doesn't expose this data. */
  monthlyCost?: number;
  /** What period monthlyCost represents. Defaults to "month". */
  spendPeriod?: "month" | "total";
  /** Month-to-date request/token count for request-based providers (Gemini without
   *  a cost/request setting). Parallel to dailyTokens. */
  monthlyTokens?: number;
  /** Daily delta vs yesterday. USD for cost-based displays, request count for
   *  request-based displays. Undefined until two consecutive days of data exist. */
  trend?: number;
  /** True when displayed spend includes a best-effort live estimate. */
  isEstimate?: boolean;
  /** Live/prepaid credit balance when a provider exposes or reports one. */
  balanceRemaining?: number;
  /** User-configured monthly budget (USD) */
  budgetTotal: number;
  /** Budget minus estimated spend (best-effort, may be zero) */
  budgetRemaining: number;
  /** Unix-ms timestamp of when this data was fetched */
  lastUpdated: number;
  /**
   * Display unit. Defaults to "usd" (cost-based display).
   * Use "requests" for providers that only expose request counts.
   */
  unit?: "usd" | "requests";
}

// --------------------------------------------------------------------------
// Structured error - every provider throws one of these
// --------------------------------------------------------------------------

export type FetchError =
  | { kind: "no-api-key" }
  | { kind: "admin-key-required" }
  | { kind: "bad-api-key"; status: number }
  | { kind: "service-account-missing" }
  | { kind: "service-account-invalid"; message: string }
  | { kind: "rate-limited"; retryAfter?: number }
  | { kind: "network-error"; message: string }
  | { kind: "api-error"; status: number }
  | { kind: "coming-soon" }
  /** Thrown by providers that have a valid API key but no public billing endpoint.
   *  Reserved for future providers — nothing currently throws this. */
  | { kind: "billing-unavailable" }
  | { kind: "unknown-error"; message: string };

// --------------------------------------------------------------------------
// How every provider's fetcher function looks
// --------------------------------------------------------------------------

/** Every provider fetcher receives the current global settings so it never
 *  needs to call getGlobalSettings() internally — avoiding the event loop
 *  that plagued the original architecture. */
export type ProviderFetcher = (settings: GlobalSettings) => Promise<UsageData>;

// --------------------------------------------------------------------------
// Provider metadata used by the registry
// --------------------------------------------------------------------------

export interface ProviderConfig {
  /** Machine-readable ID (matches action settings value) */
  id: string;
  /** Human-readable display name shown on the tile */
  name: string;
  /** The function that fetches usage data */
  fetcher: ProviderFetcher;
  /** Which global-settings key holds this provider's API key */
  keySetting: string;
  /** Accent color for visual differentiation (hex) */
  color: string;
  /** Whether this provider is fully implemented */
  implemented: boolean;
  /** Path to the provider icon, relative to .sdPlugin folder */
  iconPath: string;
}

// --------------------------------------------------------------------------
// Global settings (shared across all tile instances)
// --------------------------------------------------------------------------

export type GlobalSettings = Record<string, unknown> & {
  openaiApiKey?: string;
  /** Optional manual dashboard balance. OpenAI does not expose credit balance
   *  through the Admin API, so this is used when no budget is configured. */
  openaiCreditBalance?: number;
  claudeApiKey?: string;
  /** Optional manual dashboard balance. Anthropic Admin API exposes usage/cost,
   *  but not prepaid credit balance. */
  claudeCreditBalance?: number;
  /** Imported service account JSON from the property inspector file picker.
   *  Kept locally in Stream Deck global settings, like provider API keys. */
  geminiServiceAccountJson?: string;
  geminiServiceAccountFileName?: string;
  /** Legacy/manual fallback path. Used when no JSON has been imported. */
  geminiServiceAccountPath?: string;
  geminiProjectId?: string;
  /** Average cost per Gemini API call in USD. Used to estimate spend from
   *  request counts when no direct billing endpoint is available. */
  geminiCostPerRequest?: number;
  geminiMonthlyBudget?: number;
  deepseekApiKey?: string;
  /** Optional manual CNY→USD conversion rate. When unset, DeepSeek uses a
   *  cached live exchange-rate lookup with a hardcoded fallback. */
  deepseekCnyToUsdRate?: number;
  /** Legacy shared budget from older plugin versions. Kept only so old
   *  settings deserialize cleanly; providers no longer use it as a fallback. */
  monthlyBudget?: number;
  /** Per-provider budgets */
  openaiMonthlyBudget?: number;
  claudeMonthlyBudget?: number;
  deepseekMonthlyBudget?: number;
  openrouterApiKey?: string;
  openrouterMonthlyBudget?: number;
  grokApiKey?: string;
  grokCreditBalance?: number;
  grokMonthlyBudget?: number;
  refreshInterval?: number | string;
};

// --------------------------------------------------------------------------
// Per-tile action settings
// --------------------------------------------------------------------------

export type ActionSettings = {
  /** Which provider this tile tracks (e.g. "openai", "claude") */
  provider?: string;
  /** How the tile renders its data.
   *  "standard"      — default 3-4 line summary
   *  "big-remaining" — 2 lines: name + remaining balance/credit
   *  "big-monthly"   — 2 lines: name + month-to-date spend
   *  "big-daily"     — 2 lines: name + today's spend / request count */
  displayMode?: string;
  /** "yes" (default) shows today-vs-yesterday on the last line when data exists.
   *  "no" always shows the plain age timestamp instead. */
  showTrend?: string | boolean;
};
