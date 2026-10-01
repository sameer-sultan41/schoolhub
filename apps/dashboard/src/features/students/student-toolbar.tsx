"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, StatCard } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { StudentFormDialog } from "./student-form-dialog";

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
    queryFn: () => Services.students.fetchStudentsPage({ page: 1, pageSize: 1, status: "active" }),
  });

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
        <ToolbarHeading />
        <ToolbarActions>
          <StatCard
            label={t("stats.total")}
            value={totalQuery.data?.pagination?.total_count?.toLocaleString() ?? ""}
            state={totalQuery.isPending ? "loading" : totalQuery.isError ? "unavailable" : "ready"}
            unavailableLabel={t("stats.unavailable")}
          />
          <StatCard
            label={t("stats.active")}
            value={activeQuery.data?.pagination?.total_count?.toLocaleString() ?? ""}
            state={
              activeQuery.isPending ? "loading" : activeQuery.isError ? "unavailable" : "ready"
            }
            unavailableLabel={t("stats.unavailable")}
          />
          <span title={permissionsUnknownTitle}>
            <Button
              onClick={() => {
                setAddDialogOpen(true);
              }}
              disabled={!canCreate}
            >
              <Plus />
              {t("actions.create")}
            </Button>
          </span>
        </ToolbarActions>
      </Toolbar>
      <StudentFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} mode="create" />
    </>
  );
}
