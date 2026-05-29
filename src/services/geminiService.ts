import fs from "node:fs";
import crypto from "node:crypto";
import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";

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
//   4. Enter the file path + project ID in plugin settings
//
// What this returns: daily REQUEST COUNT (not tokens or cost — Google does not
// expose per-key token counts via Cloud Monitoring for the Developer API).

const OAUTH_URL   = "https://oauth2.googleapis.com/token";
const MONITORING  = "https://monitoring.googleapis.com/v3";
const SCOPE       = "https://www.googleapis.com/auth/monitoring.read";
const GEMINI_SVC  = "generativelanguage.googleapis.com";
const METRIC_TYPE = "serviceruntime.googleapis.com/api/request_count";

// --------------------------------------------------------------------------
// Service-account JSON shape
// --------------------------------------------------------------------------

interface ServiceAccount {
  type:         string;
  client_email: string;
  private_key:  string;
  project_id:   string;
}

// --------------------------------------------------------------------------
// Access-token cache (lives for the plugin process lifetime)
// --------------------------------------------------------------------------

let tokenCache: { value: string; expiresAt: number } | null = null;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export async function fetchGeminiUsage(gs: GlobalSettings): Promise<UsageData> {
  const saPath    = gs.geminiServiceAccountPath?.trim();
  const projectId = gs.geminiProjectId?.trim();

  if (!saPath) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(fs.readFileSync(saPath, "utf8")) as ServiceAccount;
  } catch (err: unknown) {
    throw {
      kind:    "unknown-error",
      message: `Cannot read SA file: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies FetchError;
  }

  if (sa.type !== "service_account" || !sa.client_email || !sa.private_key) {
    throw {
      kind:    "unknown-error",
      message: "Invalid service account JSON",
    } satisfies FetchError;
  }

  const project = projectId || sa.project_id;
  if (!project) {
    throw {
      kind:    "unknown-error",
      message: "No GCP project ID in settings or SA JSON",
    } satisfies FetchError;
  }

  const accessToken = await getAccessToken(sa);

  const now       = new Date();
  const startTime = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  )).toISOString();
  const endTime = now.toISOString();

  const filter =
    `metric.type="${METRIC_TYPE}" AND ` +
    `resource.labels.service="${GEMINI_SVC}"`;

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
      throw { kind: "bad-api-key", status: response.status } satisfies FetchError;
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

  const costPerReq = Math.max(0, Number(gs.geminiCostPerRequest) || 0);
  const estimatedCost = totalRequests * costPerReq;

  streamDeck.logger.info(
    `[Gemini] requests today=${totalRequests}` +
    (costPerReq > 0 ? ` estimatedCost=$${estimatedCost.toFixed(4)}` : ""),
  );

  if (costPerReq > 0) {
    // User configured a cost rate — show estimated spend instead of raw counts.
    return {
      dailyTokens:     totalRequests,
      dailyCost:       estimatedCost,
      budgetTotal:     0,
      budgetRemaining: 0,
      lastUpdated:     Date.now(),
      unit:            "usd",
    };
  }

  return {
    dailyTokens:     totalRequests,
    dailyCost:       0,
    budgetTotal:     0,
    budgetRemaining: 0,
    lastUpdated:     Date.now(),
    unit:            "requests",
  };
}

// --------------------------------------------------------------------------
// JWT + OAuth
// --------------------------------------------------------------------------

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value;
  }
  const { access_token, expires_in } = await fetchAccessToken(sa);
  tokenCache = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

async function fetchAccessToken(sa: ServiceAccount): Promise<{ access_token: string; expires_in: number }> {
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
    throw { kind: "bad-api-key", status: response.status } satisfies FetchError;
  }
  const data = await response.json() as { access_token: string; expires_in: number };
  return data;
}

function buildJWT(sa: ServiceAccount): string {
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

function b64url(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
