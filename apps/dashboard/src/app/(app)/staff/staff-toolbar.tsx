"use client";

import { useState } from "react";
import { GraduationCap, UserPlus, Users, type IdCard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { m } from "motion/react";

import { Button } from "@schoolhub/ui";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StaffFormDialog } from "@/app/(app)/staff/staff-form-dialog";
import { Services } from "@/services";

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

/** One stat chip: icon, the animated count, then its label — the same icon+count+label
 * shape `channel-stats.tsx`'s dashboard-home widgets already use, scaled down for a
 * toolbar sub-line rather than a full stat card. */
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

  const allMembers = isAllMembersPending ? null : (allStaffPage?.pagination?.total_count ?? null);
  const teachingStaff = isTeachingStaffPending ? null : (teachingStaffCount ?? null);

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
        {/* A real backend endpoint exists (StaffImportViewSet) but the actual upload/
            job-polling flow is a separate, larger feature, out of scope for this task —
            genuinely `disabled` (not just styled to look disabled), explaining why via a
            `title` — but that `title` has to live on a wrapping `<span>`, not the
            `Button` itself: `buttonVariants`' base class bakes `disabled:
            pointer-events-none` into every variant, and an element with `pointer-events:
            none` never receives the hover that would trigger its own `title` tooltip in
            any major browser. The span is not disabled, so it still receives hover and
            the tooltip fires. "Add Member" (below) no longer needs this treatment — it's
            wired up to `StaffFormDialog` (Task 3) now. */}
        <span title="Staff import is not wired up yet">
          <Button variant="outline" disabled>
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
    </Toolbar>
  );
}
