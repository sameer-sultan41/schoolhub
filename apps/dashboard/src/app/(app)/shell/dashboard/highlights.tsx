"use client";

import { Building2, GraduationCap, IdCard, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { BadgeDot, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@schoolhub/ui";

import { Services } from "@/services";

/**
 * Repurposed from the vendor Metronic template's highlights.tsx (originally a sales
 * KPI card with social-channel trend rows) into a real reference-data overview. The
 * original's per-row trend arrows/percentages are dropped rather than faked — the API
 * has no historical comparison for these counts.
 */
interface HighlightsRow {
  icon: LucideIcon;
  text: string;
  total: number | null;
}

function formatValue(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

export function Highlights({ limit }: { limit?: number }) {
  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => Services.dashboard.fetchDashboardOverview(),
  });

  if (isPending || !data) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Reference Overview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5 lg:p-7.5 lg:pt-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-2 w-full" />
          <div className="grid gap-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Coalesced to 0 here specifically for the proportional bar — an unknown count
  // contributes no width to a proportion. The row list below still shows the raw
  // nullable value via formatValue, which renders "—" rather than a fabricated 0.
  const segments = [
    { label: "Classes", value: data.classes ?? 0, color: "bg-green-500" },
    { label: "Sections", value: data.sections ?? 0, color: "bg-destructive" },
    { label: "Subjects", value: data.subjects ?? 0, color: "bg-violet-500" },
  ];
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);

  const rows: HighlightsRow[] = [
    { icon: GraduationCap, text: "Classes", total: data.classes },
    { icon: IdCard, text: "Staff", total: data.staff },
    { icon: Building2, text: "Campuses", total: data.campuses },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Reference Overview</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5 lg:p-7.5 lg:pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-normal text-secondary-foreground">Enrolled students</span>
          <span className="text-mono text-3xl font-semibold">{formatValue(data.students)}</span>
        </div>
        {segmentTotal > 0 ? (
          <div className="mb-1.5 flex items-center gap-1">
            {segments.map((segment) => (
              <div
                key={segment.label}
                className={`h-2 rounded-xs ${segment.color}`}
                style={{ width: `${(segment.value / segmentTotal) * 100}%` }}
              />
            ))}
          </div>
        ) : null}
        <div className="mb-1 flex flex-wrap items-center gap-4">
          {segments.map((segment) => (
            <div key={segment.label} className="flex items-center gap-1.5">
              <BadgeDot className={segment.color} />
              <span className="text-sm font-normal text-foreground">{segment.label}</span>
            </div>
          ))}
        </div>
        <div className="border-b border-input"></div>
        <div className="grid gap-3">
          {rows.slice(0, limit).map((row, index) => (
            <div key={index} className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <row.icon className="size-4.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-mono text-sm font-normal">{row.text}</span>
              </div>
              <span className="text-sm font-medium text-foreground">{formatValue(row.total)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
