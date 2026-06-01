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
    if (d.budgetTotal > 0)     return `${short}\n${estimatePrefix}${dollar(d.budgetRemaining)} left`;
    if (d.monthlyCost != null) return `${short}\n${estimatePrefix}${dollar(d.monthlyCost)} /mo`;
    return `${short}\n${estimatePrefix}${dollar(d.dailyCost)} today`;
  }
  if (displayMode === "big-monthly") {
    if (d.unit === "requests") return `${short}\n${compactCount(d.monthlyTokens ?? d.dailyTokens)} /mo`;
    if (d.monthlyCost != null) return `${short}\n${estimatePrefix}${dollar(d.monthlyCost)} /mo`;
    return `${short}\n${estimatePrefix}${dollar(d.dailyCost)} today`;
  }
  if (displayMode === "big-daily") {
    if (d.unit === "requests") return `${short}\n${compactCount(d.dailyTokens)} req`;
    if (d.dailyCost > 0)       return `${short}\n${estimatePrefix}${dollar(d.dailyCost)} today`;
    if (d.budgetTotal > 0)     return `${short}\n${estimatePrefix}${dollar(d.budgetRemaining)} left`;
    return `${short}\n${estimatePrefix}${dollar(d.monthlyCost ?? 0)} /mo`;
  }

  const lastLine = showTrend ? trendLine(d, now) : age;

  if (d.unit === "requests") {
    const todayStr = `${compactCount(d.dailyTokens)} req today`;
    if (d.monthlyTokens != null) {
      return `${short}\n${todayStr}\n${compactCount(d.monthlyTokens)} /mo\n${lastLine}`;
    }
    return `${short}\n${todayStr}\n${lastLine}`;
  }

  if (d.budgetTotal === 0) {
    // No budget configured — show spend, not budget remaining.
    if (d.monthlyCost != null) {
      const monthLine = `${estimatePrefix}${dollar(d.monthlyCost)} /mo`;
      // Only add a "today" sub-line when it's a useful extra (different from monthly).
      const todayUseful = d.dailyCost > 0.001 && Math.abs(d.dailyCost - d.monthlyCost) > 0.001;
      return todayUseful
        ? `${short}\n${monthLine}\n${estimatePrefix}${dollar(d.dailyCost)} today\n${lastLine}`
        : `${short}\n${monthLine}\n${lastLine}`;
    }
    if (d.dailyCost === 0) return `${short}\n$0.00 spent\n${lastLine}`;
    return `${short}\n${estimatePrefix}${dollar(d.dailyCost)} spent\n${lastLine}`;
  }

  if (d.monthlyCost != null) {
    if (d.budgetRemaining <= 0) {
      const over = dollar(Math.abs(d.budgetRemaining));
      return `${short}\n⚠ Over limit\n+${over} over\n${lastLine}`;
    }
    const pct = (d.budgetRemaining / d.budgetTotal) * 100;
    const statusPrefix = pct <= 10 ? "⚠ " : pct <= 25 ? "⚡ " : "";
    return `${statusPrefix}${short}\n${estimatePrefix}${dollar(d.budgetRemaining)} left\n${estimatePrefix}${dollar(d.monthlyCost)} /mo\n${lastLine}`;
  }

  if (d.budgetRemaining <= 0) {
    const over = dollar(Math.abs(d.budgetRemaining));
    return `${short}\n⚠ Over limit\n+${over} over`;
  }
  if (d.dailyCost === 0 && d.dailyTokens === 0) {
    return `${short}\n${estimatePrefix}${dollar(d.budgetRemaining)} left\n${lastLine}`;
  }
  const pct = (d.budgetRemaining / d.budgetTotal) * 100;
  const statusPrefix = pct <= 10 ? "⚠ " : pct <= 25 ? "⚡ " : "";
  return `${statusPrefix}${short}\n${estimatePrefix}${dollar(d.budgetRemaining)} left\n${lastLine}`;
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
