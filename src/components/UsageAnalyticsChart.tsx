import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMonthlyUsageAnalytics, type MonthlyUsageSummary } from "@/lib/analytics";

const chartConfig = {
  inputTokens: {
    label: "Prompt tokens",
    color: "var(--chart-1)",
  },
  outputTokens: {
    label: "Completion tokens",
    color: "var(--chart-2)",
  },
  totalCost: {
    label: "Total cost (USD)",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function UsageAnalyticsSkeleton() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-[320px] w-full" />
    </div>
  );
}

function UsageAnalyticsError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <h2 className="text-sm font-medium text-destructive">Usage analytics unavailable</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function UsageAnalyticsEmpty() {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
      No Langfuse generation usage recorded for the selected period yet.
    </div>
  );
}

export function UsageAnalyticsChart() {
  const [summary, setSummary] = useState<MonthlyUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetchMonthlyUsageAnalytics(12)
      .then((data) => {
        if (!active) {
          return;
        }

        setSummary(data);
        setError(null);
      })
      .catch((fetchError) => {
        if (!active) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to load analytics.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const chartData = useMemo(() => {
    if (!summary) {
      return [];
    }

    return summary.months.filter(
      (month) =>
        month.inputTokens > 0 || month.outputTokens > 0 || month.totalTokens > 0 || month.totalCost > 0,
    );
  }, [summary]);

  if (loading) {
    return <UsageAnalyticsSkeleton />;
  }

  if (error) {
    return <UsageAnalyticsError message={error} />;
  }

  if (!summary || chartData.length === 0) {
    return <UsageAnalyticsEmpty />;
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Token usage & cost</h2>
          <p className="text-sm text-muted-foreground">
            Monthly Langfuse generation metrics for the last 12 months.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Prompt tokens</p>
            <p className="font-medium">{formatTokenCount(summary.totals.inputTokens)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Completion tokens</p>
            <p className="font-medium">{formatTokenCount(summary.totals.outputTokens)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total tokens</p>
            <p className="font-medium">{formatTokenCount(summary.totals.totalTokens)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total cost</p>
            <p className="font-medium">{formatUsd(summary.totals.totalCost)}</p>
          </div>
        </div>
      </div>

      <ChartContainer config={chartConfig} className="aspect-[16/9] h-[320px] w-full">
        <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="tokens"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatTokenCount(Number(value))}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatUsd(Number(value))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const month = payload?.[0]?.payload?.monthLabel;
                  return typeof month === "string" ? month : "";
                }}
                formatter={(value, name) => {
                  const numericValue = Number(value);
                  if (name === "totalCost") {
                    return formatUsd(numericValue);
                  }

                  return formatTokenCount(numericValue);
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            yAxisId="tokens"
            dataKey="inputTokens"
            stackId="tokens"
            fill="var(--color-inputTokens)"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            yAxisId="tokens"
            dataKey="outputTokens"
            stackId="tokens"
            fill="var(--color-outputTokens)"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="cost"
            type="monotone"
            dataKey="totalCost"
            stroke="var(--color-totalCost)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ChartContainer>
    </section>
  );
}
