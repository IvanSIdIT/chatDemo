export type LangfuseMetricsQuery = {
  view: "observations";
  dimensions?: Array<{ field: string }>;
  metrics: Array<{ measure: string; aggregation: string }>;
  filters?: Array<{
    column: string;
    operator: string;
    value: string;
    type: string;
  }>;
  timeDimension?: { granularity: "month" };
  fromTimestamp: string;
  toTimestamp: string;
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
};

export type LangfuseMetricsRow = {
  time_dimension?: string;
  startTimeMonth?: string;
  sum_inputTokens?: string | number | null;
  sum_outputTokens?: string | number | null;
  sum_totalTokens?: string | number | null;
  sum_totalCost?: string | number | null;
};

export type LangfuseMetricsResponse = {
  data: LangfuseMetricsRow[];
};

export type MonthlyUsagePoint = {
  monthKey: string;
  monthLabel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
};

export type MonthlyUsageSummary = {
  months: MonthlyUsagePoint[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    totalCost: number;
  };
  range: {
    from: string;
    to: string;
  };
};

const LANGFUSE_REQUEST_TIMEOUT_MS = 15_000;

function getLangfuseBaseUrl(): string {
  return (process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com").replace(/\/$/, "");
}

function getLangfuseCredentials(): { publicKey: string; secretKey: string } {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

  if (!publicKey || !secretKey) {
    throw new Error("Langfuse API credentials are not configured on the server.");
  }

  return { publicKey, secretKey };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function monthKeyFromRow(row: LangfuseMetricsRow): string {
  if (row.startTimeMonth) {
    return row.startTimeMonth;
  }

  if (row.time_dimension) {
    return row.time_dimension.slice(0, 7);
  }

  return "unknown";
}

export function formatMonthLabel(monthKey: string): string {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthKey;
  }

  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function mapLangfuseMetricsRows(rows: LangfuseMetricsRow[]): MonthlyUsagePoint[] {
  return rows
    .map((row) => {
      const monthKey = monthKeyFromRow(row);
      const inputTokens = toNumber(row.sum_inputTokens);
      const outputTokens = toNumber(row.sum_outputTokens);
      const totalTokens = toNumber(row.sum_totalTokens) || inputTokens + outputTokens;
      const totalCost = toNumber(row.sum_totalCost);

      return {
        monthKey,
        monthLabel: formatMonthLabel(monthKey),
        inputTokens,
        outputTokens,
        totalTokens,
        totalCost,
      };
    })
    .filter((row) => row.monthKey !== "unknown")
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey));
}

function buildMonthlyUsageQuery(from: Date, to: Date): LangfuseMetricsQuery {
  return {
    view: "observations",
    metrics: [
      { measure: "inputTokens", aggregation: "sum" },
      { measure: "outputTokens", aggregation: "sum" },
      { measure: "totalTokens", aggregation: "sum" },
      { measure: "totalCost", aggregation: "sum" },
    ],
    filters: [
      {
        column: "type",
        operator: "=",
        value: "GENERATION",
        type: "string",
      },
    ],
    timeDimension: { granularity: "month" },
    fromTimestamp: from.toISOString(),
    toTimestamp: to.toISOString(),
    orderBy: [{ field: "time_dimension", direction: "asc" }],
  };
}

export async function fetchMonthlyUsageFromLangfuse(
  options?: { months?: number },
): Promise<MonthlyUsageSummary> {
  const months = Math.min(Math.max(options?.months ?? 12, 1), 24);
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1), 1));

  const { publicKey, secretKey } = getLangfuseCredentials();
  const query = buildMonthlyUsageQuery(from, to);
  const url = `${getLangfuseBaseUrl()}/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(query))}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(LANGFUSE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Langfuse metrics request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as LangfuseMetricsResponse;
  const monthRows = mapLangfuseMetricsRows(payload.data ?? []);

  const totals = monthRows.reduce(
    (accumulator, month) => ({
      inputTokens: accumulator.inputTokens + month.inputTokens,
      outputTokens: accumulator.outputTokens + month.outputTokens,
      totalTokens: accumulator.totalTokens + month.totalTokens,
      totalCost: accumulator.totalCost + month.totalCost,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, totalCost: 0 },
  );

  return {
    months: monthRows,
    totals,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
}
