export interface ClaudeReportWindow {
  startingAt: string;
  endingAt: string;
  monthStartDate: string;
  todayDate: string;
}

export function buildClaudeReportWindow(now = new Date()): ClaudeReportWindow {
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // Anthropic rejects report windows whose start and end collapse to the same
  // calendar date. On the first UTC day of a month, start one day earlier and
  // filter that extra bucket out after fetching.
  const queryStartMs = todayStartMs === monthStartMs
    ? monthStartMs - 86_400_000
    : monthStartMs;

  return {
    startingAt:     new Date(queryStartMs).toISOString(),
    endingAt:       now.toISOString(),
    monthStartDate: formatUtcDate(new Date(monthStartMs)),
    todayDate:      formatUtcDate(now),
  };
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
