"use client";

import { collectPages } from "@schoolhub/api-client";
import {
  Badge,
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
  EmptyState,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { CalendarX2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ApiErrorAlert } from "@/components/api-error-alert";
import type { TeacherLoadSummaryRow } from "@/features/academics/academics-types";
import {
  DASHBOARD_MAX_ROWS,
  DASHBOARD_REFERENCE_GC_TIME_MS,
  DASHBOARD_REFERENCE_STALE_TIME_MS,
} from "@/features/dashboard/dashboard-constants";
import type { AcademicSessionSummary } from "@/features/dashboard/dashboard-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/** Row height including its gap. Eight rows at this pitch is a panel, not a screen. */
const ROW_PITCH_PX = 36;
const CHART_PADDING_PX = 24;
/** Enough for a name at this type size; longer ones ellipsize rather than squeeze the plot. */
const NAME_AXIS_WIDTH_PX = 120;

export interface LoadDatum {
  key: string;
  name: string;
  load: number;
  overNorm: boolean;
  /**
   * Colours the bar, and is read back by `ChartTooltipContent` so the tooltip's swatch
   * matches the bar it describes. Resolves through `ChartContainer`'s custom properties
   * to `--sh-color-chart-1` / `-5`.
   */
  fill: string;
}

export interface TeacherLoadRows {
  /** What the chart plots, heaviest first, capped at `DASHBOARD_MAX_ROWS`. */
  visible: LoadDatum[];
  /** The subset the callout names in words. A status is never left to a hue. */
  overNorm: LoadDatum[];
  /** How many teachers the cap left out. Zero hides the footer. */
  remainder: number;
}

/**
 * The load summary, ordered and cut to what a dashboard panel can show.
 *
 * Pure and exported so the decisions this component makes — the ordering, the top-N cut,
 * the remainder count, which slot a bar gets — are tested where they can actually be
 * observed. They cannot be observed through the rendered chart: Recharts' category axis
 * needs real layout to place its tick text, and `jest.setup.ts` stubs
 * `getBoundingClientRect` to a fixed 640×320 for every element, so under jsdom the axis
 * renders its `<text>` nodes empty. Asserting on them would be asserting on a jsdom
 * artefact, not on this screen (the labels are present in the running app).
 *
 * Ties break on name so the order is stable: two teachers on the same load must not swap
 * places between renders.
 */
export function toTeacherLoadRows(rows: TeacherLoadSummaryRow[]): TeacherLoadRows {
  const ordered = [...rows].sort(
    (left, right) =>
      right.weekly_periods - left.weekly_periods || left.name.localeCompare(right.name),
  );

  const toDatum = (row: TeacherLoadSummaryRow): LoadDatum => ({
    key: row.staff_id,
    name: row.name,
    load: row.weekly_periods,
    overNorm: row.over_norm,
    // Slot 1 for the series and slot 5 for the exception — fixed slots, assigned by
    // meaning, never cycled and never by rank.
    fill: row.over_norm ? "var(--color-overNorm)" : "var(--color-load)",
  });

  const visible = ordered.slice(0, DASHBOARD_MAX_ROWS).map(toDatum);

  return {
    visible,
    // Filtered from EVERY row, not from the visible slice.
    //
    // The cut is ordered by load, and over-norm is not the same thing as heaviest — a
    // teacher can be over their own norm on 14 periods while eight colleagues sit above
    // them on 20. Filtering the slice dropped exactly those people from the callout, so
    // the panel would have promised "a status is never left to a hue" and then silently
    // said nothing about them. The whole point of the callout is that it survives the cut.
    overNorm: ordered.filter((row) => row.over_norm).map(toDatum),
    remainder: ordered.length - visible.length,
  };
}

/**
 * Weekly teaching load per teacher — `GET /teacher-subject-allocations/load-summary`,
 * a real server-side aggregate rather than a count assembled in the browser.
 *
 * One series, so no legend: the card title names it, and a legend for a single series is
 * furniture.
 *
 * **Every bar carries its own value.** `ChartContainer` sets `role="img"`, so the plot is
 * announced by its label and nothing inside it reaches a screen reader — and a tooltip is
 * hover-only, which a touch reader never gets at all. The `LabelList` is the figure people
 * actually read; the tooltip is the extra, not the substitute.
 *
 * **`over_norm` is a status, never a hue.** Slot 5 marks the exception bar, but the
 * finding is also stated in words below the plot, with the teacher's name, their load and
 * a warning badge — which is what a reader who cannot distinguish the two slots, or who
 * is on the far side of `role="img"`, actually gets.
 */
export function TeacherLoadChart() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { user } = useSession();

  const canView = hasPermission(user, "academics.teacher-allocation.view");
  const canReadSessions = hasPermission(user, "school.academic-session.view");

  // Same key as `useAcademicSessions()`: identical GET, identical payload, one cache
  // entry. The option type that hook returns simply does not name `is_current`, which
  // the serializer has always sent — see dashboard-types.ts.
  const sessions = useQuery({
    queryKey: queryKeys.list("school-organization", "academic-sessions"),
    queryFn: () => collectPages<AcademicSessionSummary>(apiClient, "/academic-sessions"),
    enabled: canView && canReadSessions,
    staleTime: DASHBOARD_REFERENCE_STALE_TIME_MS,
    gcTime: DASHBOARD_REFERENCE_GC_TIME_MS,
  });

  // `academic_session_id` is a required query parameter — the endpoint answers 422
  // without one — and a dashboard has no filter bar to pick from, so it resolves the
  // school's current session. `status` is the fallback for a tenant seeded before
  // `is_current` existed on the payload.
  const sessionId = useMemo(() => {
    const list = sessions.data ?? [];
    const current =
      list.find((session) => session.is_current) ?? list.find((s) => s.status === "active");
    return current?.id ?? null;
  }, [sessions.data]);

  const load = useQuery({
    queryKey: queryKeys.list("academics", "teacher-load-summary", {
      academic_session_id: sessionId,
    }),
    queryFn: async () => {
      const result = await apiClient.get<TeacherLoadSummaryRow[]>(
        "/teacher-subject-allocations/load-summary",
        { query: { academic_session_id: sessionId } },
      );
      return result.data;
    },
    enabled: canView && sessionId !== null,
  });

  // Typed to the token: a literal colour here is a compile error, not a review note.
  const chartConfig = useMemo<ChartConfig>(
    () => ({
      load: {
        label: t("teacherLoad.periodsLabel", { count: 2 }),
        color: "var(--sh-color-chart-1)",
      },
      overNorm: { label: t("teacherLoad.overNorm"), color: "var(--sh-color-chart-5)" },
    }),
    [t],
  );

  const { visible, overNorm, remainder } = useMemo(
    () => toTeacherLoadRows(load.data ?? []),
    [load.data],
  );

  if (!canView) return null;

  const error = sessions.error ?? load.error;
  const isPending =
    (canReadSessions && sessions.isPending) || (sessionId !== null && load.isPending);
  const formatPeriods = (value: number) => formatCount(value, locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("teacherLoad.title")}</CardTitle>
        <CardDescription>{t("teacherLoad.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <ApiErrorAlert error={error} />
        ) : isPending ? (
          <ChartSkeleton />
        ) : sessionId === null ? (
          // Not an error: a school between sessions is a real, temporary state, and the
          // reader can act on it.
          <EmptyState
            icon={CalendarX2}
            title={t("teacherLoad.noSessionTitle")}
            description={t("teacherLoad.noSessionDescription")}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("teacherLoad.emptyTitle")}
            description={t("teacherLoad.emptyDescription")}
          />
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              label={t("teacherLoad.title")}
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
                  content={<ChartTooltipContent valueFormatter={formatPeriods} />}
                />
                {/* No <Cell> children: Recharts v3 deprecates them and reads a `fill`
                    field off each datum instead, which every row already carries
                    (`toTeacherLoadRows` sets it). That is also what puts the right swatch
                    in the tooltip, since ChartTooltipContent reads the same field. */}
                <Bar dataKey="load" fill="var(--color-load)" radius={4} maxBarSize={20}>
                  <LabelList
                    dataKey="load"
                    position="right"
                    offset={8}
                    className="fill-foreground"
                    formatter={(value) =>
                      typeof value === "number" ? formatPeriods(value) : value
                    }
                  />
                </Bar>
              </BarChart>
            </ChartContainer>

            {overNorm.length > 0 ? (
              <ul className="space-y-1.5">
                {overNorm.map((row) => (
                  <li key={row.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate text-foreground">{row.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {`${formatPeriods(row.load)} ${t("teacherLoad.periodsLabel", { count: row.load })}`}
                    </span>
                    <Badge variant="warning">{t("teacherLoad.overNorm")}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>

      {remainder > 0 && !error ? (
        <CardFooter className="text-xs text-muted-foreground">
          {t("teacherLoad.remainder", { count: remainder })}
        </CardFooter>
      ) : null}
    </Card>
  );
}
