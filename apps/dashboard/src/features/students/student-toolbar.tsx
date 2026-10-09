"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@schoolhub/ui";
import { GraduationCap, Plus, Users, type LucideIcon } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StatChip } from "@/components/stat-chip";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { STUDENT_WITHDRAWABLE_STATUS } from "@/services/modules/students/students-constant";
import { StudentCreateStepper } from "./student-create-stepper";

type StatChipState =
  { status: "loading" } | { status: "unavailable" } | { status: "ready"; value: string };

/**
 * Three states, not `/staff`'s simpler pending-and-error-both-show-"—" collapse: a
 * skeleton while pending keeps that state distinguishable from a genuine failure (the
 * original `StatCard` this replaces drew the same distinction). `unavailableLabel` is
 * `t("stats.unavailable")`, which already reads as "—" in both locales — so the error
 * state's visible text is unchanged, only no longer reachable while still loading.
 *
 * The shared `StatChip` (`@/components/stat-chip`) is purely presentational — icon,
 * value, label, no loading concept of its own — so the loading/unavailable/ready
 * branching lives here, the caller, and only a `Skeleton` or a real string ever
 * reaches it.
 */
function StudentStatChip({
  icon,
  label,
  state,
  unavailableLabel,
}: {
  icon: LucideIcon;
  label: string;
  state: StatChipState;
  unavailableLabel: string;
}) {
  const Icon = icon;
  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-primary" aria-hidden="true" />
        <Skeleton className="h-4 w-6" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    );
  }
  return (
    <StatChip
      icon={icon}
      value={state.status === "unavailable" ? unavailableLabel : state.value}
      label={label}
    />
  );
}

/**
 * The `/students` toolbar: two live headcounts (total, active) and the New Student
 * action. Each count is its own `useQuery` — `pageSize: 1` reads the server's reported
 * `total_count` without draining the list, same pattern as `/staff`'s own toolbar counts
 * — rather than reusing the directory table's own query, which reflects whatever filter
 * the viewer currently has active.
 */
export function StudentToolbar() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  const totalQuery = useQuery({
    queryKey: queryKeys.list("students", "students", { statsAll: true }),
    queryFn: () => Services.students.fetchStudentsPage({ page: 1, pageSize: 1 }),
  });
  const activeQuery = useQuery({
    queryKey: queryKeys.list("students", "students", { statsActive: true }),
    queryFn: () =>
      Services.students.fetchStudentsPage({
        page: 1,
        pageSize: 1,
        status: STUDENT_WITHDRAWABLE_STATUS,
      }),
  });
  function statChipState(query: typeof totalQuery): StatChipState {
    if (query.isPending) return { status: "loading" };
    if (query.isError) return { status: "unavailable" };
    // `query.data` is narrowed non-nullish by the two guards above (TanStack Query's result
    // type discriminates on isPending/isError) — only `.pagination` itself is still optional.
    const count = query.data.pagination?.total_count;
    return count === undefined
      ? { status: "unavailable" }
      : { status: "ready", value: count.toLocaleString() };
  }

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const canCreate = hasPermission(currentUser, "students.student.create");
  // Fail closed, as the sidebar's own module gate does: the button stays disabled until
  // the user's permissions are actually known (the API enforces regardless), and the
  // `title` says why rather than leaving a dead button unexplained.
  const permissionsUnknownTitle = currentUser
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading
          inline
          description={
            <div className="flex w-fit shrink-0 flex-nowrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-2.5 py-1">
              <StudentStatChip
                icon={Users}
                label={t("stats.total")}
                state={statChipState(totalQuery)}
                unavailableLabel={t("stats.unavailable")}
              />
              <div className="h-4 w-px bg-border" aria-hidden="true" />
              <StudentStatChip
                icon={GraduationCap}
                label={t("stats.active")}
                state={statChipState(activeQuery)}
                unavailableLabel={t("stats.unavailable")}
              />
            </div>
          }
        />
        <ToolbarActions>
          <span title={permissionsUnknownTitle}>
            <Button
              variant="primary"
              className="transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
              onClick={() => {
                setAddDialogOpen(true);
              }}
              disabled={!canCreate}
            >
              <Plus className="transition-transform duration-200 group-hover:scale-125" />
              {t("actions.create")}
            </Button>
          </span>
        </ToolbarActions>
      </Toolbar>
      <StudentCreateStepper open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </>
  );
}
