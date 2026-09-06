"use client";

import { collectPages } from "@schoolhub/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type ChartConfig,
  ChartContainer,
  ChartSkeleton,
  ChartTooltip,
  ChartTooltipContent,
  type ChartTooltipContentProps,
  EmptyState,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { Armchair } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ApiErrorAlert } from "@/components/api-error-alert";
import {
  DASHBOARD_REFERENCE_GC_TIME_MS,
  DASHBOARD_REFERENCE_STALE_TIME_MS,
} from "@/features/dashboard/dashboard-constants";
import { takeTopRows } from "@/features/dashboard/dashboard-rows";
import type { ClassOption, SectionOption } from "@/features/students/enrollment-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { hasAllPermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

const ROW_PITCH_PX = 36;
const CHART_PADDING_PX = 24;
const NAME_AXIS_WIDTH_PX = 96;

export interface CapacityDatum {
  name: string;
  /** Sorts the bars; never drawn. Classes read in school order, not in size order. */
  level: number;
  capacity: number;
  /** Not plotted — the tooltip's label line reads it back off the hovered datum. */
  sections: number;
}

export interface CapacityRows {
  /** What the chart plots, in class-level order, capped at `DASHBOARD_MAX_ROWS`. */
  visible: CapacityDatum[];
  /** How many classes the cap left out. Zero hides the footer. */
  remainder: number;
}

/**
 * Sections folded into their classes, ordered and cut to what a dashboard panel can show.
 *
 * Pure and exported so the decisions this component makes — the grouping, what a null
 * capacity contributes, which rows survive, the ordering and the remainder — are tested
 * where they can be observed. They cannot be observed through the rendered chart:
 * Recharts' category axis needs real layout to place its tick text, and `jest.setup.ts`
 * stubs `getBoundingClientRect` to a fixed 640×320 for every element, so under jsdom the
 * axis renders its `<text>` nodes empty. That is a jsdom artefact — the class names are
 * on the axis in the running app.
 */
export function toCapacityRows(sections: SectionOption[], classes: ClassOption[]): CapacityRows {
  const byClass = new Map<string, { capacity: number; sections: number }>();
  for (const section of sections) {
    const entry = byClass.get(section.class_id) ?? { capacity: 0, sections: 0 };
    // A null capacity means "unlimited" on the model, not zero — it contributes no
    // places to a total that is explicitly about places set aside.
    entry.capacity += section.capacity ?? 0;
    entry.sections += 1;
    byClass.set(section.class_id, entry);
  }

  const classById = new Map(classes.map((option) => [option.id, option]));

  const ordered = [...byClass.entries()]
    .flatMap<CapacityDatum>(([classId, entry]) => {
      const option = classById.get(classId);
      // A section whose class the reader cannot see is a scoping answer, not a row to
      // invent a name for.
      if (!option) return [];
      return [
        {
          name: option.name,
          level: option.level,
          capacity: entry.capacity,
          sections: entry.sections,
        },
      ];
    })
    .filter((row) => row.capacity > 0)
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));

  return takeTopRows(ordered);
}

/**
 * How many sections a class has, read back off a tooltip payload row.
 *
 * Exported for its own test, and not because a one-line accessor deserves a name:
 * Recharts renders tooltip content only on a real hover, which jsdom cannot produce
 * (there is no layout for it to hit-test against), so the only way to prove this reads
 * the field it claims to is to call it. `packages/ui/src/components/chart.test.tsx`
 * documents the same limitation and solves it the same way.
 */
export function sectionsInPayload(payload: ChartTooltipContentProps["payload"]): number | null {
  const value = payload?.[0]?.payload?.sections;
  return typeof value === "number" ? value : null;
}

/**
 * Places per class — every section's `capacity`, summed by the class it belongs to.
 *
 * **This is not enrolment, and it must never be labelled as such.** No endpoint in the
 * product returns enrolled counts per section; `capacity` is how many places the school
 * has set up. A chart titled "Students per class" over this data would be a lie told in
 * a shape people trust, so the title says "Places by class" and the axis caption says
 * capacity.
 *
 * Ordered by class level, not by size: a class is an entity, and reordering entities by
 * rank makes a chart that reshuffles under the reader whenever a section is added. One
 * series, one fixed slot, no legend.
 *
 * Every bar carries its value directly — `ChartContainer` sets `role="img"`, so nothing
 * inside the plot reaches a screen reader, and a hover-only tooltip reaches no touch
 * reader at all. The tooltip adds the section count behind the total, which is the
 * question the total invites rather than the answer it gives.
 */
export function CapacityChart() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { user } = useSession();

  // Both keys, not either: the chart is section capacity grouped under class names, and
  // it has nothing honest to draw without both halves. In the shipped permission model
  // they always travel together (ALL_STAFF holds both).
  const canView = hasAllPermissions(user, ["school.section.view", "school.class.view"]);

  const sections = useQuery({
    queryKey: queryKeys.list("school-organization", "sections", { scope: "all" }),
    queryFn: () => collectPages<SectionOption>(apiClient, "/sections"),
    enabled: canView,
    staleTime: DASHBOARD_REFERENCE_STALE_TIME_MS,
    gcTime: DASHBOARD_REFERENCE_GC_TIME_MS,
  });

  const classes = useQuery({
    queryKey: queryKeys.list("school-organization", "classes"),
    queryFn: () => collectPages<ClassOption>(apiClient, "/classes"),
    enabled: canView,
    staleTime: DASHBOARD_REFERENCE_STALE_TIME_MS,
    gcTime: DASHBOARD_REFERENCE_GC_TIME_MS,
  });

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      capacity: {
        label: t("capacity.placesLabel", { count: 2 }),
        color: "var(--sh-color-chart-2)",
      },
    }),
    [t],
  );

  const { visible, remainder } = useMemo(
    () => toCapacityRows(sections.data ?? [], classes.data ?? []),
    [sections.data, classes.data],
  );

  if (!canView) return null;

  const error = sections.error ?? classes.error;
  const isPending = sections.isPending || classes.isPending;
  const formatPlaces = (value: number) => formatCount(value, locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("capacity.title")}</CardTitle>
        <CardDescription>{t("capacity.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <ApiErrorAlert error={error} />
        ) : isPending ? (
          <ChartSkeleton />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Armchair}
            title={t("capacity.emptyTitle")}
            description={t("capacity.emptyDescription")}
          />
        ) : (
          <>
            {/* The measured axis, in words. The numeric axis itself is hidden: every bar
                is labelled directly, so a tick scale would be a second reading of the
                same figures. */}
            <p className="text-xs text-muted-foreground">{t("capacity.axisLabel")}</p>
            <ChartContainer
              config={chartConfig}
              label={t("capacity.title")}
              className="w-full"
              style={{ height: visible.length * ROW_PITCH_PX + CHART_PADDING_PX }}
            >
              <BarChart
                data={visible}
                layout="vertical"
                margin={{ top: 4, right: 44, bottom: 4, left: 0 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={NAME_AXIS_WIDTH_PX}
                  tickLine={false}
                  axisLine={false}
                  // Every row is named, always. Recharts otherwise drops ticks it thinks
                  // will not fit, measured from rendered text — and a chart that silently
                  // stops labelling half its bars is worse than one that wraps.
                  interval={0}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      valueFormatter={formatPlaces}
                      labelFormatter={(label, payload) => {
                        const sectionCount = sectionsInPayload(payload);
                        const isText = typeof label === "string" || typeof label === "number";
                        if (sectionCount === null || !isText) return label;
                        return `${label} · ${t("capacity.sections", { count: sectionCount })}`;
                      }}
                    />
                  }
                />
                <Bar dataKey="capacity" fill="var(--color-capacity)" radius={4} maxBarSize={20}>
                  <LabelList
                    dataKey="capacity"
                    position="right"
                    offset={8}
                    className="fill-foreground"
                    formatter={(value) => (typeof value === "number" ? formatPlaces(value) : value)}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </>
        )}
      </CardContent>

      {remainder > 0 && !error ? (
        <CardFooter className="text-xs text-muted-foreground">
          {t("capacity.remainder", { count: remainder })}
        </CardFooter>
      ) : null}
    </Card>
  );
}
