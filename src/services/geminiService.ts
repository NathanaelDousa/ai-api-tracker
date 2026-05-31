import crypto from "node:crypto";
import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { providerBudget } from "./budget";
import { readGeminiServiceAccount, type GeminiServiceAccount } from "./geminiCredentials";
import { recordAndGetTrend } from "./trendStore";

// ============================================================================
// Gemini Usage Service — Google Cloud Monitoring API
// ============================================================================
//
// Google's Gemini API exposes no usage endpoint accessible with a simple API
// key. Instead we query Cloud Monitoring, which requires a service account.
//
// Setup for users:
//   1. GCP project with Gemini API + Cloud Monitoring API enabled
//   2. Service account with roles/monitoring.viewer
//   3. Download service account JSON key file
//   4. Import the JSON file in plugin settings
//
// What this returns: successful daily REQUEST COUNT. When the user provides an
// average cost/request, we convert request counts to estimated spend.

const OAUTH_URL   = "https://oauth2.googleapis.com/token";
const MONITORING  = "https://monitoring.googleapis.com/v3";
const SCOPE       = "https://www.googleapis.com/auth/monitoring.read";
const GEMINI_SVC  = "generativelanguage.googleapis.com";
const METRIC_TYPE = "serviceruntime.googleapis.com/api/request_count";

// --------------------------------------------------------------------------
// Access-token cache (lives for the plugin process lifetime)
// --------------------------------------------------------------------------

let tokenCache: { key: string; value: string; expiresAt: number } | null = null;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export async function fetchGeminiUsage(gs: GlobalSettings): Promise<UsageData> {
  const sa        = readGeminiServiceAccount(gs);
  const projectId = gs.geminiProjectId?.trim();

  const project = projectId || sa.project_id;
  if (!project) {
    throw {
      kind:    "service-account-invalid",
      message: "No GCP project ID in settings or SA JSON",
    } satisfies FetchError;
  }

  const accessToken = await getAccessToken(sa);

  const now = new Date();
  const todayStartTime = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  )).toISOString();
  const monthStartTime = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), 1,
  )).toISOString();
  const endTime = now.toISOString();

  const costPerReq = Math.max(0, Number(gs.geminiCostPerRequest) || 0);
  const budget = providerBudget(gs, "geminiMonthlyBudget");

  // Always fetch both periods in parallel — monthly is shown even without cost/req.
  const [todayRequests, monthlyRequests] = await Promise.all([
    fetchRequestCount(accessToken, project, todayStartTime, endTime),
    fetchRequestCount(accessToken, project, monthStartTime,  endTime),
  ]);

  streamDeck.logger.info(
    `[Gemini] today=${todayRequests} month=${monthlyRequests}` +
    (costPerReq > 0 ? ` costPerReq=$${costPerReq}` : ""),
  );

  if (costPerReq > 0) {
    const estimatedDailyCost   = todayRequests   * costPerReq;
    const estimatedMonthlyCost = monthlyRequests * costPerReq;
    const trend = recordAndGetTrend("gemini:usd", round3(estimatedDailyCost));
    return {
      dailyTokens:     todayRequests,
      monthlyTokens:   monthlyRequests,
      dailyCost:       round3(estimatedDailyCost),
      monthlyCost:     round2(estimatedMonthlyCost),
      trend,
      isEstimate:      true,
      budgetTotal:     budget,
      budgetRemaining: round2(budget - estimatedMonthlyCost),
      lastUpdated:     Date.now(),
      unit:            "usd",
    };
  }

  const trend = recordAndGetTrend("gemini:requests", todayRequests);
  return {
    dailyTokens:     todayRequests,
    monthlyTokens:   monthlyRequests,
    dailyCost:       0,
    trend,
    budgetTotal:     0,
    budgetRemaining: 0,
    lastUpdated:     Date.now(),
    unit:            "requests",
  };
}

async function fetchRequestCount(accessToken: string, project: string, startTime: string, endTime: string): Promise<number> {
  const filter =
    `metric.type="${METRIC_TYPE}" AND ` +
    `resource.labels.service="${GEMINI_SVC}" AND ` +
    `metric.labels.response_code_class="2xx"`;

  const params = new URLSearchParams({
    filter,
    "interval.startTime":             startTime,
    "interval.endTime":               endTime,
    "aggregation.alignmentPeriod":    "86400s",
    "aggregation.perSeriesAligner":   "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });

  const url = `${MONITORING}/projects/${encodeURIComponent(project)}/timeSeries?${params}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
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
      tokenCache = null;
      const body = await response.text().catch(() => "");
      streamDeck.logger.warn(`[Gemini] Monitoring API ${response.status}: ${body.slice(0, 300)}`);
      const billingRequired = body.includes("billing");
      throw {
        kind:    "service-account-invalid",
        message: response.status === 403
          ? (billingRequired ? "Enable billing on GCP project" : "SA needs monitoring.viewer role")
          : "SA credentials rejected",
      } satisfies FetchError;
    }
    if (response.status === 429) {
      throw { kind: "rate-limited" } satisfies FetchError;
    }
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  type TSPoint = { value: { int64Value?: string } };
  type TSSeries = { points?: TSPoint[] };
  const body = await response.json() as { timeSeries?: TSSeries[] };

  let totalRequests = 0;
  for (const series of (body.timeSeries ?? [])) {
    for (const point of (series.points ?? [])) {
      totalRequests += parseInt(point.value.int64Value ?? "0", 10) || 0;
    }
  }

  return totalRequests;
}

// --------------------------------------------------------------------------
// JWT + OAuth
// --------------------------------------------------------------------------

async function getAccessToken(sa: GeminiServiceAccount): Promise<string> {
  const cacheKey = tokenCacheKey(sa);
  if (tokenCache && tokenCache.key === cacheKey && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value;
  }
  const { access_token, expires_in } = await fetchAccessToken(sa);
  tokenCache = { key: cacheKey, value: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

async function fetchAccessToken(sa: GeminiServiceAccount): Promise<{ access_token: string; expires_in: number }> {
  const jwt = buildJWT(sa);
  let response: Response;
  try {
    response = await fetch(OAUTH_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    throw {
      kind:    "network-error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies FetchError;
  }
  if (!response.ok) {
    throw {
      kind:    "service-account-invalid",
      message: `OAuth failed (${response.status}): check SA credentials`,
    } satisfies FetchError;
  }
  const data = await response.json() as { access_token: string; expires_in: number };
  return data;
}

function buildJWT(sa: GeminiServiceAccount): string {
  const now  = Math.floor(Date.now() / 1000);
  const head = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud:  OAUTH_URL,
    iat:  now,
    exp:  now + 3600,
  })));
  const data = `${head}.${body}`;
  const sig  = b64url(crypto.createSign("RSA-SHA256").update(data).sign(sa.private_key));
  return `${data}.${sig}`;
}

function tokenCacheKey(sa: GeminiServiceAccount): string {
  return crypto
    .createHash("sha256")
    .update(sa.client_email)
    .update("\0")
    .update(sa.private_key)
    .digest("hex");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
