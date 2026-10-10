"use client";

import { useState } from "react";
import { GraduationCap, UserPlus, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@schoolhub/ui";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { BulkImportDialog } from "@/components/bulk-import-dialog";
import { StatChip } from "@/components/stat-chip";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useJobFileDownload } from "@/hooks/use-job-file-download";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  STAFF_EXPORT_FILENAME,
  STAFF_IMPORT_JOB_STORAGE_PREFIX,
  STAFF_IMPORT_OPTIONAL_COLUMNS,
  STAFF_IMPORT_REQUIRED_COLUMNS,
} from "@/services/modules/staff/staff-constant";
import { StaffFormDialog } from "./staff-form-dialog";

/**
 * The `/staff` toolbar's live stat line and its two action buttons — split out of
 * `page.tsx` (a plain server component) because the stat line needs client-side data
 * fetching for two real counts. This follows this app's own established
 * `dashboard/page.tsx` -> `DashboardPageContent` delegation pattern (a thin server route
 * handing off to one "use client" content component), rather than converting the whole
 * route to `"use client"` the way the vendor's own team-crew `page.tsx` does — the rest
 * of `/staff`'s page (the directory table) has no reason to lose server rendering just
 * because the toolbar needs a client query.
 *
 * Ported from Metronic's `network/user-table/team-crew/page.tsx` toolbar: same
 * `ToolbarHeading`/`ToolbarActions` shell and the same "label: value  label: value" stat
 * line markup/classes, but the vendor's "Pro Licenses" (no licensing concept exists for a
 * school) is replaced with a second REAL number, Teaching Staff headcount — see the
 * plan's "Toolbar's stat line" note. Both counts come from real service calls
 * (`Services.staff.fetchStaffPage`/`fetchStaffTypeCount`), never a fabricated number;
 * a `null`/pending count renders "—", the same convention `highlights.tsx`'s own
 * `formatValue` already established for a pending numeric stat elsewhere in this app.
 */
function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

// `AnimatedStat`/`StatChip` live in `@/components/stat-chip` — shared with `/students`'s
// toolbar (and any future module's) so this shape has exactly one place to change.

export function StaffToolbar() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const t = useTranslations("staff");
  const tCommon = useTranslations("common");

  // `pageSize: 1` mirrors dashboard-service.ts's own fetchTotal and staff-service.ts's
  // own fetchStaffTypeCount
  // pattern: read the server's reported total_count without draining the list. This is
  // deliberately its own query, not reused from the directory table's: the table's own
  // fetchStaffPage call reflects whatever search/status filter the user currently has
  // active, but "All Members" here must always mean the school's true, unfiltered
  // headcount.
  const { data: allStaffPage, isPending: isAllMembersPending } = useQuery({
    queryKey: queryKeys.list("staff", "staff", { statsAll: true }),
    queryFn: () => Services.staff.fetchStaffPage({ pageSize: 1 }),
  });
  const { data: teachingStaffCount, isPending: isTeachingStaffPending } = useQuery({
    queryKey: queryKeys.list("staff", "staff", { statsTeaching: true }),
    queryFn: () => Services.staff.fetchStaffTypeCount("teaching"),
  });
  // The same shared query `sidebar-menu.tsx`'s own permission check already populates —
  // this never issues a second request.
  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();

  const allMembers = isAllMembersPending ? null : (allStaffPage?.pagination?.total_count ?? null);
  const teachingStaff = isTeachingStaffPending ? null : (teachingStaffCount ?? null);

  // Fail closed, as the sidebar's own module gate does: both buttons stay disabled until
  // the user's permissions are actually known (the API enforces regardless). Every
  // disabled state still says why — "you don't have permission" only once a loaded user
  // backs that claim, and a lookup that failed for good says so rather than leaving a
  // dead button with no explanation.
  const canExport = hasPermission(currentUser, "staff.staff.export");
  const canImport = hasPermission(currentUser, "staff.staff.import");
  const permissionsUnknownTitle = currentUser
    ? undefined
    : isCurrentUserError
      ? tCommon("permissionsLoadFailed")
      : tCommon("permissionsLoading");
  const exportTitle =
    permissionsUnknownTitle ?? (canExport ? undefined : t("export.permissionTitle"));
  const importTitle =
    permissionsUnknownTitle ?? (canImport ? undefined : t("import.permissionTitle"));

  const exportJob = useJobFileDownload({
    module: "staff",
    start: () => Services.staff.triggerStaffExport(),
    filename: STAFF_EXPORT_FILENAME,
    messages: {
      startFailed: t("export.startFailed"),
      downloadFailed: t("export.downloadFailed"),
      timedOut: t("export.timedOut"),
      failed: t("export.failed"),
      success: () => t("export.success"),
    },
  });

  return (
    <Toolbar>
      <ToolbarHeading
        inline
        description={
          <div className="flex w-fit shrink-0 flex-nowrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-2.5 py-1">
            <StatChip icon={Users} value={formatCount(allMembers)} label="All Members" />
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            <StatChip
              icon={GraduationCap}
              value={formatCount(teachingStaff)}
              label="Teaching Staff"
            />
          </div>
        }
      />
      <ToolbarActions>
        {/* On a wrapping `<span>`, not the `Button`: `buttonVariants` bakes
            `disabled:pointer-events-none` into every variant, and a disabled button
            would never receive the hover that shows its own `title`. */}
        <span title={exportTitle}>
          <Button
            variant="outline"
            disabled={!canExport || exportJob.isBusy}
            onClick={() => {
              exportJob.run();
            }}
          >
            {exportJob.isBusy
              ? t("export.exporting")
              : exportJob.isStalled
                ? t("export.checkStatus")
                : t("export.button")}
          </Button>
        </span>
        <span title={importTitle}>
          <Button
            variant="outline"
            disabled={!canImport}
            onClick={() => {
              setImportDialogOpen(true);
            }}
          >
            {t("import.button")}
          </Button>
        </span>
        <Button
          variant="primary"
          className="transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
          onClick={() => {
            setAddDialogOpen(true);
          }}
        >
          {/* Button's own base class already includes `group` — no need to add it here. */}
          <UserPlus className="transition-transform duration-200 group-hover:scale-125" />
          Add Member
        </Button>
      </ToolbarActions>
      <StaffFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} mode="create" />
      <BulkImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        module="staff"
        title={t("import.title")}
        description={t("import.description")}
        requiredColumns={STAFF_IMPORT_REQUIRED_COLUMNS}
        optionalColumns={STAFF_IMPORT_OPTIONAL_COLUMNS}
        storageKeyPrefix={STAFF_IMPORT_JOB_STORAGE_PREFIX}
        start={Services.staff.triggerStaffImport}
      />
    </Toolbar>
  );
}
