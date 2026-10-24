"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, Button, Card, EmptyState, Skeleton } from "@schoolhub/ui";
import { Clock, LayoutGrid } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { NoSessionCard } from "@/components/academic-session/no-session-card";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type TimetableConflict, type TimetableSlotRecord } from "@/services";
import { TIMETABLE_SLOTS_QUERY_MODULE } from "@/services/modules/timetable-slots/timetable-slots-constant";
import type { GridCell } from "@/services/modules/timetable-slots/timetable-slots-helper";
import { ConflictPanel } from "./conflict-panel";
import { DiscardDraftDialog } from "./discard-draft-dialog";
import { GridPickers } from "./grid-pickers";
import { PublishDialog } from "./publish-dialog";
import type { GridPosition } from "./resolve-drop";
import { cellButtonId } from "./slot-cell";
import { SlotFormDialog } from "./slot-form-dialog";
import { useCellLabel } from "./use-cell-label";
import { useWeekGrid } from "./use-week-grid";
import { WeekGrid } from "./week-grid";

/**
 * `/timetable/grid`: one section's week. Pick the session, class and section; fill or edit a
 * cell; drag a draft to an empty cell; check for conflicts; publish. Findings from the last
 * write, check or refused publish are kept here, not in the query cache: they describe what
 * the builder just did, and a refetch of the grid must not clear them. They belong to one
 * session's section, and read as nothing once the screen moves to another.
 */
export function TimetableGridScreen() {
  const t = useTranslations("timetable");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const tSession = useTranslations("academicSession");
  const queryClient = useQueryClient();
  const grid = useWeekGrid();
  const cellLabelOf = useCellLabel();

  const scope = `${grid.academicSessionId}:${grid.section?.id ?? ""}`;
  const [findings, setFindings] = useState<{
    scope: string;
    conflicts: TimetableConflict[];
  } | null>(null);
  const conflicts = findings?.scope === scope ? findings.conflicts : [];
  const checked = findings?.scope === scope;
  const [editing, setEditing] = useState<{ position: GridPosition; cell?: GridCell } | null>(null);
  const [discarding, setDiscarding] = useState<TimetableSlotRecord | null>(null);
  const [publishing, setPublishing] = useState(false);

  const { data: user } = useCurrentUser();
  const editable = !grid.isLocked;
  const canCreate = editable && hasPermission(user, "timetable.slot.create");
  const canUpdate = editable && hasPermission(user, "timetable.slot.update");
  const canDelete = editable && hasPermission(user, "timetable.slot.delete");
  // Independent of the cell keys: a principal publishes without editing cells.
  const canPublish = editable && hasPermission(user, "timetable.timetable.publish");

  const showConflicts = (found: TimetableConflict[]) => {
    setFindings({ scope, conflicts: found });
  };
  const errorText = (error: unknown) =>
    resolveErrorMessage(error, tErrors, tCommon("submitFailed"), "non_field");

  const validate = useMutation({
    mutationFn: () =>
      Services.timetableSlots.validateSection(grid.section?.id ?? "", grid.academicSessionId),
    onSuccess: (result) => {
      showConflicts(result.conflicts);
    },
    onError: (error) => {
      toast.error(errorText(error));
    },
  });
  const move = useMutation({
    mutationFn: ({ slot, target }: { slot: TimetableSlotRecord; target: GridPosition }) =>
      Services.timetableSlots.updateSlot(slot.id, {
        dayOfWeek: target.dayOfWeek,
        periodId: target.periodId,
      }),
    onSuccess: async (result, { slot }) => {
      showConflicts(result.conflicts);
      toast.success(t("grid.moved"));
      // The handle that started a keyboard move is gone with its old cell; put focus on the
      // cell the class moved to once the grid has redrawn it.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.module(TIMETABLE_SLOTS_QUERY_MODULE),
      });
      document.getElementById(cellButtonId(slot.id))?.focus();
    },
    onError: (error) => {
      toast.error(errorText(error));
    },
  });

  const ready = grid.section !== null && grid.session !== null;
  const slotLabel = (slotId: string) => {
    const slot = grid.slots.find((candidate) => candidate.id === slotId);
    return slot ? cellLabelOf(slot.day_of_week, slot.period_name) : undefined;
  };

  function body() {
    if (grid.isError) {
      return (
        <LoadErrorCard
          message={t("grid.loadError")}
          onRetry={() => {
            void grid.refetch();
          }}
        />
      );
    }
    if (!grid.isLoading && grid.session === null) {
      return (
        <NoSessionCard
          sessions={grid.sessions}
          onPick={(id) => {
            grid.pick("session", id);
          }}
        />
      );
    }
    if (!ready) {
      return (
        <Card>
          <EmptyState
            icon={LayoutGrid}
            title={t("grid.pickSectionTitle")}
            description={t("grid.pickSection")}
          />
        </Card>
      );
    }
    const failed = grid.periodsQuery.error ?? grid.slotsQuery.error;
    if (failed) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(failed, tErrors, t("grid.loadError"))}
          onRetry={() => {
            void grid.periodsQuery.refetch();
            void grid.slotsQuery.refetch();
          }}
        />
      );
    }
    // Never draw the cells before they are known: an empty index reads as "Fill" everywhere,
    // and filling a cell that already has a draft would hide a second one under it.
    if (!grid.periods || grid.slotsQuery.data === undefined) {
      return <Skeleton className="h-96 w-full" />;
    }
    if (grid.periods.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Clock}
            title={t("grid.noPeriodsTitle")}
            description={t("grid.noPeriods")}
          />
        </Card>
      );
    }
    return (
      <div className="space-y-4">
        <ConflictPanel
          conflicts={conflicts}
          checked={checked}
          cellLabelFor={slotLabel}
          onGoTo={(slotId) => {
            document.getElementById(cellButtonId(slotId))?.focus();
          }}
        />
        <WeekGrid
          periods={grid.periods}
          weekdays={grid.weekdays}
          cells={grid.cells}
          conflicts={conflicts}
          canCreate={canCreate}
          canUpdate={canUpdate}
          // No second drag while a move is in flight: the cell index is a move behind.
          isMoving={move.isPending}
          canDelete={canDelete}
          onOpenCell={(position, cell) => {
            setEditing({ position, cell });
          }}
          onDiscard={setDiscarding}
          onMove={(slot, target) => {
            move.mutate({ slot, target });
          }}
          onRefused={(reason) => {
            toast.error(reason);
          }}
        />
      </div>
    );
  }

  const cellLabel = editing
    ? cellLabelOf(
        editing.position.dayOfWeek,
        grid.periods?.find((period) => period.id === editing.position.periodId)?.name ?? "",
      )
    : "";

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("grid.title")} description={t("grid.summary")} />
        <ToolbarActions>
          <Button
            variant="outline"
            disabled={!ready}
            isLoading={validate.isPending}
            loadingLabel={tCommon("loading")}
            onClick={() => {
              validate.mutate();
            }}
          >
            {t("actions.validate")}
          </Button>
          {canPublish && (
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                setPublishing(true);
              }}
            >
              {t("actions.publish")}
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>
      <div className="mb-5">
        <GridPickers grid={grid} />
      </div>
      {grid.isLocked && grid.session && (
        <Alert variant="info" appearance="light" className="mb-5">
          <AlertDescription>
            {tSession("lockedNotice", { session: grid.session.name })}
          </AlertDescription>
        </Alert>
      )}
      {body()}
      {editing && grid.section && (
        <SlotFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          cell={{
            academicSessionId: grid.academicSessionId,
            classId: grid.classId,
            sectionId: grid.section.id,
            campusId: grid.campusId,
            dayOfWeek: editing.position.dayOfWeek,
            periodId: editing.position.periodId,
            label: cellLabel,
          }}
          slot={editing.cell?.slot}
          onConflicts={showConflicts}
        />
      )}
      {discarding && (
        <DiscardDraftDialog
          open
          onOpenChange={(open) => {
            if (!open) setDiscarding(null);
          }}
          slot={discarding}
          onConflicts={showConflicts}
        />
      )}
      {publishing && grid.section && (
        <PublishDialog
          open
          onOpenChange={setPublishing}
          sectionId={grid.section.id}
          academicSessionId={grid.academicSessionId}
          onConflicts={showConflicts}
        />
      )}
    </>
  );
}
