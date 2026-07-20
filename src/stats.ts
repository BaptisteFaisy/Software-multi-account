export const STATS_RANGE_OPTIONS = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
] as const;

export type StatsRangeDays = (typeof STATS_RANGE_OPTIONS)[number]["days"];

export const WORK_TIME_GRANULARITY_OPTIONS = [
  { id: "day", label: "Jour", bucketCount: 14 },
  { id: "week", label: "Semaine", bucketCount: 12 },
  { id: "month", label: "Mois", bucketCount: 12 },
] as const;

export type WorkTimeGranularity = (typeof WORK_TIME_GRANULARITY_OPTIONS)[number]["id"];

export type WorkTimeDay = {
  date: string;
  activeSeconds: number;
  turnCount: number;
};

export type WorkTimeBucket = {
  key: string;
  startDate: string;
  endDate: string;
  activeSeconds: number;
  turnCount: number;
  activeDays: number;
};

export type ApiModelTokenUsage = {
  model: string;
  pricingModel?: string | null;
  priced: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  apiEquivalentUsd: number;
  inputPricePerMillion?: number | null;
  cachedInputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  longContextThresholdTokens?: number | null;
  longInputPricePerMillion?: number | null;
  longCachedInputPricePerMillion?: number | null;
  longOutputPricePerMillion?: number | null;
  longContextRequests: number;
};

export type DailyTokenUsage = {
  date: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  models?: ApiModelTokenUsage[];
};

export type AccountTokenUsageSource = {
  accounts: ReadonlyArray<{
    id: string;
    label: string;
    codexHome?: string;
    profileLabels?: ReadonlyArray<string>;
    usageSource?: string;
    sourceError?: string | null;
    error?: string | null;
    totalTokens?: number;
    days: ReadonlyArray<DailyTokenUsage>;
  }>;
};

export type DailyAccountTokenUsage = {
  accountId: string;
  label: string;
  profileLabels: ReadonlyArray<string>;
  usageSource: string;
  totalTokens: number;
  share: number;
  error?: string | null;
};

const emptyDailyTokenUsage = (date: string): DailyTokenUsage => ({
  date,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  models: [],
});

export const aggregateApiModelUsage = (
  usages: ReadonlyArray<ApiModelTokenUsage>,
): ApiModelTokenUsage[] => {
  const byModel = new Map<string, ApiModelTokenUsage>();

  for (const usage of usages) {
    const model = usage.model?.trim().toLocaleLowerCase("en-US") || "modele-inconnu";
    const current = byModel.get(model) ?? {
      ...usage,
      model,
      priced: Boolean(usage.priced),
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      apiEquivalentUsd: 0,
      longContextRequests: 0,
    };
    current.priced ||= Boolean(usage.priced);
    current.inputTokens += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
    current.cachedInputTokens += Number.isFinite(usage.cachedInputTokens)
      ? usage.cachedInputTokens
      : 0;
    current.outputTokens += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
    current.reasoningOutputTokens += Number.isFinite(usage.reasoningOutputTokens)
      ? usage.reasoningOutputTokens
      : 0;
    current.totalTokens += Number.isFinite(usage.totalTokens) ? usage.totalTokens : 0;
    current.apiEquivalentUsd += Number.isFinite(usage.apiEquivalentUsd)
      ? usage.apiEquivalentUsd
      : 0;
    current.longContextRequests += Number.isFinite(usage.longContextRequests)
      ? usage.longContextRequests
      : 0;
    byModel.set(model, current);
  }

  return [...byModel.values()].sort(
    (left, right) =>
      right.totalTokens - left.totalTokens || left.model.localeCompare(right.model, "fr"),
  );
};

const accountUsageIdentityKey = (
  account: AccountTokenUsageSource["accounts"][number],
): string => {
  const rawHome = account.codexHome?.trim();
  let normalizedHome = rawHome?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    normalizedHome &&
    (rawHome?.includes("\\") ||
      /^[a-z]:\//i.test(normalizedHome) ||
      /^%cst_data_dir%\//i.test(normalizedHome))
  ) {
    normalizedHome = normalizedHome.toLocaleLowerCase("en-US");
  }
  return normalizedHome ? `home:${normalizedHome}` : `profile:${account.id}`;
};

const accountUsageCompleteness = (
  account: AccountTokenUsageSource["accounts"][number],
): number => {
  if (Number.isFinite(account.totalTokens)) return Math.max(0, account.totalTokens ?? 0);
  return account.days.reduce((total, day) => total + day.totalTokens, 0);
};

/**
 * Les anciennes versions du serveur renvoyaient une ligne par profil, meme
 * lorsque plusieurs profils pointaient vers exactement le meme CODEX_HOME.
 * Ces lignes decrivent la meme source et ne doivent jamais etre additionnees.
 */
export const deduplicateAccountTokenAccounts = <
  T extends AccountTokenUsageSource["accounts"][number],
>(
  accounts: ReadonlyArray<T>,
): T[] => {
  const unique = new Map<string, T>();
  for (const account of accounts) {
    const key = accountUsageIdentityKey(account);
    const current = unique.get(key);
    if (!current || accountUsageCompleteness(account) > accountUsageCompleteness(current)) {
      unique.set(key, account);
    }
  }
  return [...unique.values()];
};

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

const dateKeyParts = (dateKey: string): [number, number, number] | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const utcDateKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isoWeekStart = (dateKey: string): string => {
  const parts = dateKeyParts(dateKey);
  if (!parts) return dateKey;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return utcDateKey(date);
};

const shiftMonthStart = (dateKey: string, offsetMonths: number): string => {
  const parts = dateKeyParts(dateKey);
  if (!parts) return dateKey;
  return utcDateKey(new Date(Date.UTC(parts[0], parts[1] - 1 + offsetMonths, 1)));
};

export const recentDateKeys = (endDate: string, dayCount: number): string[] => {
  const safeDayCount = Math.max(1, Math.floor(dayCount));
  return Array.from({ length: safeDayCount }, (_, index) =>
    shiftDateKey(endDate, index - safeDayCount + 1),
  );
};

export const aggregateAccountTokenDays = (
  data: AccountTokenUsageSource,
): Map<string, DailyTokenUsage> => {
  const byDate = new Map<string, DailyTokenUsage>();

  for (const account of deduplicateAccountTokenAccounts(data.accounts)) {
    for (const day of account.days) {
      const total = byDate.get(day.date) ?? emptyDailyTokenUsage(day.date);
      total.inputTokens += day.inputTokens;
      total.cachedInputTokens += day.cachedInputTokens;
      total.outputTokens += day.outputTokens;
      total.totalTokens += day.totalTokens;
      total.costUsd += day.costUsd;
      total.models = aggregateApiModelUsage([...(total.models ?? []), ...(day.models ?? [])]);
      byDate.set(day.date, total);
    }
  }

  return byDate;
};

export const buildAccountTokenSeries = (
  data: AccountTokenUsageSource,
  endDate: string,
  dayCount: number,
): DailyTokenUsage[] => {
  const byDate = aggregateAccountTokenDays(data);
  return recentDateKeys(endDate, dayCount).map(
    (date) => byDate.get(date) ?? emptyDailyTokenUsage(date),
  );
};

const workTimeBucketRanges = (
  endDate: string,
  granularity: WorkTimeGranularity,
): Array<Pick<WorkTimeBucket, "key" | "startDate" | "endDate">> => {
  const option = WORK_TIME_GRANULARITY_OPTIONS.find((item) => item.id === granularity);
  const bucketCount = option?.bucketCount ?? 12;

  if (granularity === "day") {
    return recentDateKeys(endDate, bucketCount).map((date) => ({
      key: date,
      startDate: date,
      endDate: date,
    }));
  }

  if (granularity === "week") {
    const currentWeek = isoWeekStart(endDate);
    return Array.from({ length: bucketCount }, (_, index) => {
      const startDate = shiftDateKey(currentWeek, (index - bucketCount + 1) * 7);
      return {
        key: startDate,
        startDate,
        endDate: shiftDateKey(startDate, 6),
      };
    });
  }

  const currentMonth = shiftMonthStart(endDate, 0);
  return Array.from({ length: bucketCount }, (_, index) => {
    const startDate = shiftMonthStart(currentMonth, index - bucketCount + 1);
    return {
      key: startDate.slice(0, 7),
      startDate,
      endDate: shiftDateKey(shiftMonthStart(startDate, 1), -1),
    };
  });
};

export const buildWorkTimeBuckets = (
  days: ReadonlyArray<WorkTimeDay>,
  endDate: string,
  granularity: WorkTimeGranularity,
): WorkTimeBucket[] =>
  workTimeBucketRanges(endDate, granularity).map((range) => {
    const bucketDays = days.filter(
      (day) => day.date >= range.startDate && day.date <= range.endDate,
    );
    return {
      ...range,
      activeSeconds: bucketDays.reduce((total, day) => total + day.activeSeconds, 0),
      turnCount: bucketDays.reduce((total, day) => total + day.turnCount, 0),
      activeDays: bucketDays.filter((day) => day.activeSeconds > 0).length,
    };
  });

export const accountTokenUsageForDate = (
  data: AccountTokenUsageSource,
  date: string,
): DailyAccountTokenUsage[] => {
  const rows = deduplicateAccountTokenAccounts(data.accounts).map((account) => ({
    accountId: account.id,
    label: account.label,
    profileLabels: account.profileLabels ?? [account.label],
    usageSource: account.usageSource ?? "local-sessions",
    totalTokens: account.days
      .filter((day) => day.date === date)
      .reduce((total, day) => total + day.totalTokens, 0),
    share: 0,
    error: account.error ?? account.sourceError,
  }));
  const totalTokens = rows.reduce((total, account) => total + account.totalTokens, 0);

  return rows
    .map((account) => ({
      ...account,
      share: totalTokens > 0 ? account.totalTokens / totalTokens : 0,
    }))
    .sort((left, right) =>
      right.totalTokens !== left.totalTokens
        ? right.totalTokens - left.totalTokens
        : left.label.localeCompare(right.label, "fr"),
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
      models: aggregateApiModelUsage([...(total.models ?? []), ...(day.models ?? [])]),
    }),
    emptyDailyTokenUsage(days.length > 0 ? days[days.length - 1].date : ""),
  );
