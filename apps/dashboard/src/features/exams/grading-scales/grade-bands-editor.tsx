"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { CircleCheck, CircleX, Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type GradeBandRecord, type GradingScaleRecord } from "@/services";
import {
  GRADING_SCALES_BANDS_RESOURCE,
  GRADING_SCALES_QUERY_MODULE,
} from "@/services/modules/grading-scales/grading-scales-constant";
import {
  checkBandCoverage,
  nextSortOrder,
} from "@/services/modules/grading-scales/grading-scales-helper";
import { DeleteGradeBandDialog } from "./delete-grade-band-dialog";
import { GradeBandCoverage } from "./grade-band-coverage";
import { GradeBandForm } from "./grade-band-form";

/** What the inline form is doing: adding a band, editing one, or closed. */
type FormState = { mode: "create" } | { mode: "edit"; band: GradeBandRecord } | null;

const SKELETON_ROWS = [0, 1, 2];

/**
 * A scale's bands in display order, with add, edit and remove (the write keys gate each), and
 * the advisory coverage check computed from those rows. The form is inline, so a server refusal
 * lands under its field without a second dialog stacked on this one.
 */
export function GradeBandsEditor({ scale }: { scale: GradingScaleRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");

  const [formState, setFormState] = useState<FormState>(null);
  const [removeTarget, setRemoveTarget] = useState<GradeBandRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canCreate = hasPermission(currentUser, "exams.grading-scale.create");
  const canUpdate = hasPermission(currentUser, "exams.grading-scale.update");

  const query = useQuery({
    queryKey: queryKeys.list(GRADING_SCALES_QUERY_MODULE, GRADING_SCALES_BANDS_RESOURCE, {
      scaleId: scale.id,
    }),
    queryFn: () => Services.gradingScales.fetchBands(scale.id),
  });

  const bands = useMemo(() => query.data ?? [], [query.data]);
  const issues = useMemo(() => checkBandCoverage(bands), [bands]);

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("gradingScales.bands.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("gradingScales.bands.description")}</p>
      {query.isPending ? (
        <div className="space-y-2">
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <>
          <GradeBandCoverage issues={issues} />
          {bands.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("gradingScales.bands.columns.label")}</TableHead>
                  <TableHead>{t("gradingScales.bands.columns.range")}</TableHead>
                  <TableHead>{t("gradingScales.bands.columns.gradePoint")}</TableHead>
                  <TableHead>{t("gradingScales.bands.columns.result")}</TableHead>
                  <TableHead>{t("gradingScales.bands.columns.remark")}</TableHead>
                  {canUpdate && (
                    <TableHead>
                      <span className="sr-only">{t("gradingScales.bands.columns.actions")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bands.map((band) => (
                  <TableRow key={band.id}>
                    <TableCell className="font-medium">{band.label}</TableCell>
                    <TableCell>
                      {t("gradingScales.bands.range", {
                        min: band.min_percent,
                        max: band.max_percent,
                      })}
                    </TableCell>
                    <TableCell>{band.grade_point ?? EMPTY_VALUE}</TableCell>
                    <TableCell>
                      {band.is_passing === false ? (
                        <Badge variant="secondary" appearance="light">
                          <CircleX className="size-3" aria-hidden="true" />
                          {t("gradingScales.bands.failing")}
                        </Badge>
                      ) : (
                        <Badge variant="success" appearance="light">
                          <CircleCheck className="size-3" aria-hidden="true" />
                          {t("gradingScales.bands.passing")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{band.remark ?? EMPTY_VALUE}</TableCell>
                    {canUpdate && (
                      <TableCell>
                        <RowEditRemoveActions
                          editLabel={t("gradingScales.bands.actions.editRow", {
                            label: band.label,
                          })}
                          onEdit={() => {
                            setFormState({ mode: "edit", band });
                          }}
                          removeLabel={t("gradingScales.bands.actions.deleteRow", {
                            label: band.label,
                          })}
                          onRemove={() => {
                            setRemoveTarget(band);
                          }}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
      {formState && (
        <GradeBandForm
          key={formState.mode === "edit" ? formState.band.id : "create"}
          scaleId={scale.id}
          band={formState.mode === "edit" ? formState.band : undefined}
          nextSortOrder={nextSortOrder(bands)}
          onDone={() => {
            setFormState(null);
          }}
        />
      )}
      {canCreate && !formState && !query.isPending && (
        <Button
          variant="outline"
          onClick={() => {
            setFormState({ mode: "create" });
          }}
        >
          <Plus aria-hidden="true" />
          {t("gradingScales.bands.actions.add")}
        </Button>
      )}
      {removeTarget && (
        <DeleteGradeBandDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          scaleId={scale.id}
          band={removeTarget}
        />
      )}
    </div>
  );
}
