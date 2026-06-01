import type { UsageData } from "../services/types";

export interface TitleFormatOptions {
  displayMode?: string;
  showTrend?: boolean;
  now?: number;
}

export function formatUsageTitle(name: string, d: UsageData, options: TitleFormatOptions = {}): string {
  const displayMode = options.displayMode ?? "standard";
  const showTrend   = options.showTrend ?? true;
  const now         = options.now ?? Date.now();
  const short       = name.length > 7 ? name.slice(0, 6) + "…" : name;
  const age         = timeAgo(d.lastUpdated, now);
  const estimatePrefix = d.isEstimate ? "~" : "";

  // Stream Deck auto-sizes text, so fewer lines = larger font.
  if (displayMode === "big-remaining") {
    if (d.unit === "requests") return `${short}\n${compactCount(d.monthlyTokens ?? d.dailyTokens)} /mo`;
    return `${short}\n${remainingLine(d, estimatePrefix)}`;
  }
  if (displayMode === "big-monthly") {
    if (d.unit === "requests") return `${short}\n${compactCount(d.monthlyTokens ?? d.dailyTokens)} /mo`;
    return `${short}\n${estimatePrefix}${spendAmount(d)}`;
  }
  if (displayMode === "big-daily") {
    if (d.unit === "requests") return `${short}\n${compactCount(d.dailyTokens)} req`;
    return `${short}\n${estimatePrefix}${dollar(d.dailyCost)} today`;
  }

  const lastLine = showTrend ? trendLine(d, now) : age;

  if (d.unit === "requests") {
    const todayStr = `${compactCount(d.dailyTokens)} req today`;
    return `${short}\n${todayStr}\n${compactCount(d.monthlyTokens ?? 0)} /mo\n${lastLine}`;
  }

  return `${statusPrefix(d)}${short}\n${remainingLine(d, estimatePrefix)}\n${estimatePrefix}${spendAmount(d)}\n${lastLine}`;
}

function remainingLine(d: UsageData, estimatePrefix: string): string {
  if (!hasKnownRemaining(d)) return `${estimatePrefix}${dollar(d.dailyCost)} today`;
  return `${estimatePrefix}${dollar(remainingAmount(d))} left`;
}

function remainingAmount(d: UsageData): number {
  if (d.balanceRemaining != null) return Math.max(0, d.balanceRemaining);
  if (d.budgetTotal > 0) return Math.max(0, d.budgetRemaining);
  return 0;
}

function hasKnownRemaining(d: UsageData): boolean {
  return d.balanceRemaining != null || d.budgetTotal > 0;
}

function statusPrefix(d: UsageData): string {
  if (d.budgetTotal <= 0) return "";
  const pct = (remainingAmount(d) / d.budgetTotal) * 100;
  return pct <= 10 ? "⚠ " : pct <= 25 ? "⚡ " : "";
}

function spendAmount(d: UsageData): string {
  const cost = d.monthlyCost ?? 0;
  const suffix = d.spendPeriod === "total" ? "used" : "/mo";
  return `${dollar(cost)} ${suffix}`;
}

function trendLine(d: UsageData, now: number): string {
  const age = timeAgo(d.lastUpdated, now);
  if (d.trend == null) return age;

  const abs       = Math.abs(d.trend);
  const threshold = d.unit === "requests" ? 0.5 : 0.005;
  const arrow     = d.trend > threshold ? "↑" : d.trend < -threshold ? "↓" : "→";
  const compact   = compactAge(d.lastUpdated, now);

  if (d.unit === "requests") {
    return `${arrow}${compactCount(abs)} req · ${compact}`;
  }
  return `${arrow}${d.isEstimate ? "~" : ""}${dollar(abs)} · ${compact}`;
}

function dollar(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function compactCount(n: number): string {
  const count = Math.round(Number.isFinite(n) ? n : 0);
  if (count >= 1_000_000) return `${trimFixed(count / 1_000_000)}M`;
  if (count >= 1_000)     return `${trimFixed(count / 1_000)}k`;
  return String(count);
}

function trimFixed(n: number): string {
  return n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
}

function timeAgo(ts: number, now: number): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function compactAge(ts: number, now: number): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 60)  return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}
