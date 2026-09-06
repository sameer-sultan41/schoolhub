"use client";

import { collectPages, fetchPage } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { StatCard } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import {
  Blocks,
  BookOpen,
  Building2,
  DoorOpen,
  Flag,
  GraduationCap,
  IdCard,
  type LucideIcon,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { Can } from "@/components/can";
import {
  DASHBOARD_REFERENCE_GC_TIME_MS,
  DASHBOARD_REFERENCE_STALE_TIME_MS,
  TIMETABLE_VIEW_PERMISSION,
} from "@/features/dashboard/dashboard-constants";
import type { CountableRecord } from "@/features/dashboard/dashboard-types";
import { apiClient } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

type ShapeLabelKey =
  "classes" | "sections" | "subjects" | "rooms" | "houses" | "campuses" | "students" | "staff";

interface CountTile {
  labelKey: ShapeLabelKey;
  path: string;
  permission: PermissionKey;
  icon: LucideIcon;
  /** Query key parts, matched to the reference-data hooks so one cache entry serves both. */
  module: string;
  resource: string;
  params?: Record<string, unknown>;
}

/**
 * The six lists that are genuinely small enough to drain and count.
 *
 * `/rooms` is gated on `timetable.timetable.view`, not a `school.room.view` that does not
 * exist: rooms live in the timetable module and apps/timetable/views.py reads them under
 * the timetable view key (its `SCAFFOLDING_VIEW_KEY`).
 */
const COUNT_TILES: CountTile[] = [
  {
    labelKey: "classes",
    path: "/classes",
    permission: "school.class.view",
    icon: GraduationCap,
    module: "school-organization",
    resource: "classes",
  },
  {
    labelKey: "sections",
    path: "/sections",
    permission: "school.section.view",
    icon: Blocks,
    module: "school-organization",
    resource: "sections",
    params: { scope: "all" },
  },
  {
    labelKey: "subjects",
    path: "/subjects",
    permission: "school.subject.view",
    icon: BookOpen,
    module: "school-organization",
    resource: "subjects",
  },
  {
    labelKey: "rooms",
    path: "/rooms",
    permission: TIMETABLE_VIEW_PERMISSION,
    icon: DoorOpen,
    module: "timetable",
    resource: "rooms",
    params: { scope: "count" },
  },
  {
    labelKey: "houses",
    path: "/houses",
    permission: "school.house.view",
    icon: Flag,
    module: "school-organization",
    resource: "houses",
  },
  {
    labelKey: "campuses",
    path: "/campuses",
    permission: "school.campus.view",
    icon: Building2,
    module: "school-organization",
    resource: "campuses",
  },
];

interface TotalTile {
  labelKey: ShapeLabelKey;
  path: string;
  permission: PermissionKey;
  icon: LucideIcon;
  module: string;
  resource: string;
}

/** The two head counts, which come from the server's own total rather than from draining a list. */
const TOTAL_TILES: TotalTile[] = [
  {
    labelKey: "students",
    path: "/students",
    permission: "students.student.view",
    icon: Users,
    module: "students",
    resource: "students",
  },
  {
    labelKey: "staff",
    path: "/staff",
    permission: "staff.staff.view",
    icon: IdCard,
    module: "staff",
    resource: "staff",
  },
];

/**
 * The shape of the school in figures.
 *
 * Every tile here is a number the API can actually answer. Nothing on this row promises
 * attendance, fees or admissions: those modules have no backend at all, and the screen
 * this replaced rendered a red error alert for all three — an error is a claim that
 * something broke, which was never true.
 */
export function SchoolShapePanel() {
  const t = useTranslations("dashboard");
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="font-heading text-base font-semibold text-foreground">
        {t("shape.title")}
      </h2>
      {/* Eight tiles read as a strip on a wide screen and as pairs on a phone. Two rows
          of four was right at the foot of the page; directly under the hero, one row is. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        {COUNT_TILES.map((tile) => (
          <Can key={tile.labelKey} permission={tile.permission}>
            <CountedTile tile={tile} />
          </Can>
        ))}
        {TOTAL_TILES.map((tile) => (
          <Can key={tile.labelKey} permission={tile.permission}>
            <TotalCountTile tile={tile} />
          </Can>
        ))}
      </div>
    </section>
  );
}

/**
 * A tile whose figure comes from draining the list.
 *
 * Only ever pointed at the bounded reference lists — a school has tens of classes and
 * hundreds of rooms, not the unbounded tables `collectPages` would be wrong for. Cached
 * for ten minutes and keyed exactly as the reference-data hooks key them, so opening a
 * screen that needs the same list does not fetch it twice.
 */
function CountedTile({ tile }: { tile: CountTile }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.list(tile.module, tile.resource, tile.params),
    queryFn: () => collectPages<CountableRecord>(apiClient, tile.path),
    staleTime: DASHBOARD_REFERENCE_STALE_TIME_MS,
    gcTime: DASHBOARD_REFERENCE_GC_TIME_MS,
  });

  return (
    <StatCard
      label={t(`shape.${tile.labelKey}`)}
      icon={tile.icon}
      state={isPending ? "loading" : isError ? "unavailable" : "ready"}
      // "Unavailable right now", not "not counted yet": a failed request is a temporary
      // state, and telling the reader the feature does not exist would be a different
      // claim entirely.
      unavailableLabel={t("shape.unknown")}
      value={formatCount(data?.length ?? 0, locale)}
    />
  );
}

/**
 * A tile whose figure comes from `meta.pagination.total_count` on a single-row page.
 *
 * One cheap request, never a drained list: `/students` and `/staff` grow with the school
 * and paging through them to count them would be an unbounded read for a figure the
 * server already knows. `CountedCursorPagination` (apps/api/core/api/pagination.py)
 * counts on the queryset as narrowed — tenant scope, record scope and filters applied —
 * so the number matches the rows this reader can actually see.
 *
 * The absent case stays live and stays honest. `total_count` is optional in the contract
 * and an endpoint that does not count omits the field rather than sending null, so a
 * missing total renders `unavailable` — never a zero, and never an error.
 */
function TotalCountTile({ tile }: { tile: TotalTile }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.list(tile.module, tile.resource, { scope: "total" }),
    queryFn: () => fetchPage<CountableRecord>(apiClient, tile.path, { query: { page_size: 1 } }),
  });

  const pagination = data?.pagination;
  const total = pagination && "total_count" in pagination ? pagination.total_count : undefined;
  const state = isPending ? "loading" : !isError && total !== undefined ? "ready" : "unavailable";

  return (
    <StatCard
      label={t(`shape.${tile.labelKey}`)}
      icon={tile.icon}
      state={state}
      unavailableLabel={isError ? t("shape.unknown") : t("shape.unavailable")}
      value={formatCount(total ?? 0, locale)}
      footer={state === "unavailable" && !isError ? t("shape.unavailableNote") : undefined}
    />
  );
}
