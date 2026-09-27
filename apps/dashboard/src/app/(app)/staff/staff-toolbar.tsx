"use client";

import { useEffect, useState } from "react";
import { GraduationCap, UserPlus, Users, type IdCard } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { m } from "motion/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@schoolhub/ui";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StaffFormDialog } from "@/app/(app)/staff/staff-form-dialog";
import { StaffImportDialog } from "@/app/(app)/staff/staff-import-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useJobPolling } from "@/hooks/use-job-polling";
import { hasPermission } from "@/lib/permissions";
import { ApiError, Services } from "@/services";
import type { ExportJobResult } from "@/services/modules/jobs/jobs-service";

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
 * (`Services.dashboard.fetchStaffPage`/`fetchStaffTypeCount`), never a fabricated number;
 * a `null`/pending count renders "—", the same convention `highlights.tsx`'s own
 * `formatValue` already established for a pending numeric stat elsewhere in this app.
 */
function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

/**
 * The "—" → real-number swap, animated once. `key={value}` is what makes this a real
 * element change to Motion (not a prop update on the same node), so `initial` actually
 * fires when the count first resolves — a single, orchestrated reveal for a real state
 * change (data landing), not a repeating decorative tic on every render.
 */
function AnimatedStat({ value }: { value: string }) {
  return (
    <m.span
      key={value}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="inline-block text-sm leading-none font-semibold text-foreground tabular-nums"
    >
      {value}
    </m.span>
  );
}

/** One stat chip: icon, animated count, label. */
function StatChip({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof IdCard;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-primary" aria-hidden="true" />
      <AnimatedStat value={value} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function StaffToolbar() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const tErrors = useTranslations("errors");

  // `pageSize: 1` mirrors dashboard-service.ts's own fetchTotal/fetchStaffTypeCount
  // pattern: read the server's reported total_count without draining the list. This is
  // deliberately its own query, not reused from the directory table's: the table's own
  // fetchStaffPage call reflects whatever search/status filter the user currently has
  // active, but "All Members" here must always mean the school's true, unfiltered
  // headcount.
  const { data: allStaffPage, isPending: isAllMembersPending } = useQuery({
    queryKey: ["staff", "toolbar", "all-members-count"],
    queryFn: () => Services.dashboard.fetchStaffPage({ pageSize: 1 }),
  });
  const { data: teachingStaffCount, isPending: isTeachingStaffPending } = useQuery({
    queryKey: ["staff", "toolbar", "teaching-staff-count"],
    queryFn: () => Services.dashboard.fetchStaffTypeCount("teaching"),
  });
  // Same cache entry `sidebar-menu.tsx`'s own permission check already populates
  // (Task 3's `queryKeys.currentUser()`, not a second inline literal) — this never
  // issues a second request.
  const { data: currentUser } = useCurrentUser();

  const allMembers = isAllMembersPending ? null : (allStaffPage?.pagination?.total_count ?? null);
  const teachingStaff = isTeachingStaffPending ? null : (teachingStaffCount ?? null);

  const canExport = hasPermission(currentUser, "staff.staff.export");
  const canImport = hasPermission(currentUser, "staff.staff.import");

  const exportTrigger = useMutation({
    mutationFn: () => Services.staff.triggerStaffExport(),
    onSuccess: (result) => {
      setExportJobId(result.jobId);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? tErrors.has(error.code)
            ? tErrors(error.code)
            : error.message
          : "The export could not be started.";
      toast.error(message);
    },
  });

  const {
    job: exportJob,
    isPolling: isExportPolling,
    isTimedOut: isExportTimedOut,
    isError: isExportError,
  } = useJobPolling("staff", exportJobId);

  // A `useMutation` for the download step itself (not a raw promise chain in the
  // effect below) so `isDownloadPending` is available to keep the button disabled for
  // the whole "job succeeded, now fetching the actual URL" gap — without it, the
  // button re-enables the instant the job reaches "succeeded" (isPolling already
  // reads false by then), and a double-click there would start a second, redundant
  // export while the first one's download is still being fetched.
  //
  // Destructured (not kept as `downloadTrigger.mutate`) specifically so `mutate` can
  // be named directly in the effect's own dependency array below: TanStack Query
  // wraps `mutate` in its own `useCallback` bound to the mutation observer
  // (`@tanstack/react-query`'s `useMutation.js`), so — unlike the mutation's own
  // result object, which IS a fresh object every render — this specific function
  // reference is stable across re-renders of this component instance. That is what
  // lets the effect list its real dependencies in full and satisfy
  // `react-hooks/exhaustive-deps` with no disable comment, unlike `exit-staff-
  // dialog.tsx`'s own (real, but avoidable) precedent for the same rule.
  const { mutate: downloadExportFile, isPending: isDownloadPending } = useMutation({
    mutationFn: (fileId: string) => Services.jobs.fetchFileDownloadUrl(fileId),
    onSuccess: (url) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = "staff-export.csv";
      link.click();
      toast.success("Staff list exported");
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "The export file could not be downloaded.",
      );
    },
  });

  // `exportJob`'s reference changes on every poll while running, so this re-runs each
  // tick, but is a no-op until the job actually reaches `succeeded`/`failed`, and a
  // no-op again after that (the reference stays stable once `refetchInterval` stops),
  // so `downloadExportFile` fires exactly once per terminal job. No
  // `setExportJobId(null)` anywhere in this component: a fresh "Export CSV" click
  // already overwrites it via `onSuccess` above, and `isExportPolling` already reads
  // `false` once the job hook reports terminal/timed-out/errored — nothing is left to
  // reset by hand.
  useEffect(() => {
    if (exportJob?.status === "succeeded") {
      const resultFileId = (exportJob.result as ExportJobResult | null)?.result_file_id;
      if (resultFileId) {
        downloadExportFile(resultFileId);
      }
    }
    if (exportJob?.status === "failed") {
      toast.error(exportJob.error ?? "The export failed.");
    }
  }, [exportJob, downloadExportFile]);

  useEffect(() => {
    if (isExportTimedOut) {
      toast.error("The export is taking longer than expected. Try again in a moment.");
    }
  }, [isExportTimedOut]);

  useEffect(() => {
    if (isExportError) {
      toast.error("The export failed.");
    }
  }, [isExportError]);

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
        <span title={canExport ? undefined : "You don't have permission to export staff."}>
          <Button
            variant="outline"
            disabled={!canExport || exportTrigger.isPending || isExportPolling || isDownloadPending}
            onClick={() => {
              exportTrigger.mutate();
            }}
          >
            {exportTrigger.isPending || isExportPolling || isDownloadPending
              ? "Exporting…"
              : "Export CSV"}
          </Button>
        </span>
        <span title={canImport ? undefined : "You don't have permission to import staff."}>
          <Button
            variant="outline"
            disabled={!canImport}
            onClick={() => {
              setImportDialogOpen(true);
            }}
          >
            Import CSV
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
      <StaffImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
    </Toolbar>
  );
}
