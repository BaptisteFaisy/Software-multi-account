export const STATS_RANGE_OPTIONS = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
] as const;

export type StatsRangeDays = (typeof STATS_RANGE_OPTIONS)[number]["days"];

export type DailyTokenUsage = {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type AccountUsageSource = {
  accounts: ReadonlyArray<{
    days: ReadonlyArray<DailyTokenUsage>;
  }>;
};

const emptyDailyTokenUsage = (date: string): DailyTokenUsage => ({
  date,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
});

const shiftDateKey = (dateKey: string, offsetDays: number): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;

  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offsetDays),
  );
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const recentDateKeys = (endDate: string, dayCount: number): string[] => {
  const safeDayCount = Math.max(1, Math.floor(dayCount));
  return Array.from({ length: safeDayCount }, (_, index) =>
    shiftDateKey(endDate, index - safeDayCount + 1),
  );
};

export const aggregateAccountTokenDays = (
  data: AccountUsageSource,
): Map<string, DailyTokenUsage> => {
  const byDate = new Map<string, DailyTokenUsage>();

  for (const account of data.accounts) {
    for (const day of account.days) {
      const total = byDate.get(day.date) ?? emptyDailyTokenUsage(day.date);
      total.inputTokens += day.inputTokens;
      total.cachedInputTokens += day.cachedInputTokens;
      total.outputTokens += day.outputTokens;
      total.totalTokens += day.totalTokens;
      total.costUsd += day.costUsd;
      byDate.set(day.date, total);
    }
  }

  return byDate;
};

export const buildAccountTokenSeries = (
  data: AccountUsageSource,
  endDate: string,
  dayCount: number,
): DailyTokenUsage[] => {
  const byDate = aggregateAccountTokenDays(data);
  return recentDateKeys(endDate, dayCount).map(
    (date) => byDate.get(date) ?? emptyDailyTokenUsage(date),
  );
};

export const sumTokenUsage = (days: ReadonlyArray<DailyTokenUsage>): DailyTokenUsage =>
  days.reduce<DailyTokenUsage>(
    (total, day) => ({
      date: day.date,
      inputTokens: total.inputTokens + day.inputTokens,
      cachedInputTokens: total.cachedInputTokens + day.cachedInputTokens,
      outputTokens: total.outputTokens + day.outputTokens,
      totalTokens: total.totalTokens + day.totalTokens,
      costUsd: total.costUsd + day.costUsd,
    }),
    emptyDailyTokenUsage(days.length > 0 ? days[days.length - 1].date : ""),
  );
