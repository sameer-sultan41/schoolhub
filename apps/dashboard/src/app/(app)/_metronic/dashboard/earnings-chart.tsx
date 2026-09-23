"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@schoolhub/ui";

// apexcharts touches `window` at import time, so it's loaded client-only via
// next/dynamic — the vendor template (page-router-shaped) imports it directly,
// which would break this app's server-rendered root layout.
const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Ported from the vendor Metronic Next.js template's app/(protected)/components/
// demo1/light-sidebar/components/earnings-chart.tsx (apexcharts dynamic-import
// wrapper aside, content and options are unchanged).
const DUMMY_CHART_DATA: number[] = [58, 64, 52, 45, 42, 38, 45, 53, 56, 65, 75, 85];
const CATEGORIES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function EarningsChart() {
  const [chartData] = useState<number[]>(DUMMY_CHART_DATA);

  const options: ApexOptions = {
    series: [{ name: "Earnings", data: chartData }],
    chart: { height: 250, type: "area", toolbar: { show: false } },
    dataLabels: { enabled: false },
    legend: { show: false },
    stroke: { curve: "smooth", show: true, width: 3, colors: ["var(--color-primary)"] },
    xaxis: {
      categories: CATEGORIES,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: "var(--color-secondary-foreground)", fontSize: "12px" } },
      crosshairs: {
        position: "front",
        stroke: { color: "var(--color-primary)", width: 1, dashArray: 3 },
      },
      tooltip: { enabled: false },
    },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      axisTicks: { show: false },
      labels: {
        style: { colors: "var(--color-secondary-foreground)", fontSize: "12px" },
        formatter: (value) => `$${value}K`,
      },
    },
    tooltip: {
      enabled: true,
      custom({
        series,
        seriesIndex,
        dataPointIndex,
        w,
      }: {
        series: number[][];
        seriesIndex: number;
        dataPointIndex: number;
        w: { globals: { seriesX: number[][] } };
      }) {
        const number = (series[seriesIndex]?.[dataPointIndex] ?? 0) * 1000;
        const month = w.globals.seriesX[seriesIndex]?.[dataPointIndex];
        const monthName = month === undefined ? "" : (CATEGORIES[month] ?? "");
        const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
        const formattedNumber = formatter.format(number);
        return `
          <div class="flex flex-col gap-2 p-3.5">
            <div class="font-medium text-sm text-secondary-foreground">${monthName}, 2024 Sales</div>
            <div class="flex items-center gap-1.5">
              <div class="font-semibold text-base text-mono">${formattedNumber}</div>
              <span class="rounded-full border border-green-200 font-medium dark:border-green-850 text-success-700 bg-green-100 dark:bg-green-950/30 text-[11px] leading-none px-1.25 py-1">+24%</span>
            </div>
          </div>
        `;
      },
    },
    markers: {
      size: 0,
      colors: ["var(--color-white)"],
      strokeColors: "var(--color-primary)",
      strokeWidth: 4,
      strokeOpacity: 1,
      fillOpacity: 1,
      shape: "circle",
      hover: { size: 8, sizeOffset: 0 },
    },
    fill: { gradient: { opacityFrom: 0.25, opacityTo: 0 } },
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
        <CardTitle>Earnings</CardTitle>
        <div className="flex gap-5">
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-update" className="text-sm">
              Referrals only
            </Label>
            <Switch id="auto-update" defaultChecked size="sm" />
          </div>
          <Select defaultValue="1">
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="w-28">
              <SelectItem value="1">1 month</SelectItem>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
              <SelectItem value="12">12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex grow flex-col items-stretch justify-end px-3 py-1">
        <ApexChart
          id="earnings_chart"
          options={options}
          series={options.series}
          type="area"
          height="250"
        />
      </CardContent>
    </Card>
  );
}
