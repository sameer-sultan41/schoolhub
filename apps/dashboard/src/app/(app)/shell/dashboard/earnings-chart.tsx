"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@schoolhub/ui";

import { Services } from "@/services";

// apexcharts touches `window` at import time, so it's loaded client-only via
// next/dynamic — same reasoning as the vendor template's own earnings-chart.tsx.
const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const MAX_TEACHERS_SHOWN = 10;

/**
 * Repurposed from the vendor Metronic template's earnings-chart.tsx (originally a
 * 12-month fake revenue trend) into the real weekly teacher-load aggregate for the
 * current academic session — a school has no monthly revenue figure to chart, so this
 * charts a real server-side aggregate as a bar per teacher instead of a time series.
 */
export function EarningsChart() {
  const sessions = useQuery({
    queryKey: ["dashboard", "academic-sessions"],
    queryFn: () => Services.dashboard.fetchAcademicSessions(),
  });

  const sessionId = useMemo(() => {
    const list = sessions.data ?? [];
    const current =
      list.find((session) => session.is_current) ??
      list.find((session) => session.status === "active");
    return current?.id ?? null;
  }, [sessions.data]);

  const load = useQuery({
    queryKey: ["dashboard", "teacher-load-summary", sessionId],
    queryFn: () => Services.dashboard.fetchTeacherLoadSummary(sessionId as string),
    enabled: sessionId !== null,
  });

  const rows = useMemo(
    () =>
      [...(load.data ?? [])]
        .sort((a, b) => b.weekly_periods - a.weekly_periods)
        .slice(0, MAX_TEACHERS_SHOWN),
    [load.data],
  );

  const isPending = sessions.isPending || (sessionId !== null && load.isPending);

  const options: ApexOptions = {
    series: [{ name: "Weekly periods", data: rows.map((row) => row.weekly_periods) }],
    chart: { height: 250, type: "bar", toolbar: { show: false } },
    dataLabels: { enabled: false },
    legend: { show: false },
    plotOptions: { bar: { borderRadius: 4, columnWidth: "50%" } },
    colors: ["var(--color-primary)"],
    xaxis: {
      categories: rows.map((row) => row.name),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: { colors: "var(--color-secondary-foreground)", fontSize: "11px" },
        rotate: -45,
        trim: true,
      },
    },
    yaxis: {
      labels: { style: { colors: "var(--color-secondary-foreground)", fontSize: "12px" } },
    },
    grid: {
      borderColor: "var(--color-border)",
      strokeDashArray: 5,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Teacher Load</CardTitle>
      </CardHeader>
      <CardContent className="flex grow flex-col items-stretch justify-end px-3 py-1">
        {isPending ? (
          <Skeleton className="h-[250px] w-full" />
        ) : rows.length > 0 ? (
          <ApexChart
            id="teacher_load_chart"
            options={options}
            series={options.series}
            type="bar"
            height="250"
          />
        ) : (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No teaching load recorded for the current session.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
