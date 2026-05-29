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
  /** Month-to-date spend in USD. Undefined for balance-based providers (DeepSeek)
   *  or when the provider doesn't expose monthly data (Gemini). */
  monthlyCost?: number;
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
  | { kind: "bad-api-key"; status: number }
  | { kind: "rate-limited"; retryAfter?: number }
  | { kind: "network-error"; message: string }
  | { kind: "api-error"; status: number }
  | { kind: "coming-soon" }
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
  claudeApiKey?: string;
  geminiApiKey?: string;
  geminiServiceAccountPath?: string;
  geminiProjectId?: string;
  /** Average cost per Gemini API call in USD. Used to estimate spend from
   *  request counts when no direct billing endpoint is available. */
  geminiCostPerRequest?: number;
  deepseekApiKey?: string;
  /** Shared fallback budget used when a provider-specific budget is not set */
  monthlyBudget?: number;
  /** Per-provider budgets — override monthlyBudget when set */
  openaiMonthlyBudget?: number;
  claudeMonthlyBudget?: number;
  deepseekMonthlyBudget?: number;
  refreshInterval?: number;
};

// --------------------------------------------------------------------------
// Per-tile action settings
// --------------------------------------------------------------------------

export type ActionSettings = {
  /** Which provider this tile tracks (e.g. "openai", "claude") */
  provider?: string;
};
