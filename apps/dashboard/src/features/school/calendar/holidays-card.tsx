"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { CalendarOff, Plus } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { useCampuses } from "@/hooks/use-reference-data";
import { formatDate } from "@/lib/helpers";
import { Services, type HolidayEntry } from "@/services";
import {
  holidaysByDate,
  withoutHoliday,
} from "@/services/modules/school-organization/school-organization-helper";
import { HolidayFormDialog } from "./holiday-form-dialog";

/** Which dialog is open: the form (with the entry's place when editing) or the remove. */
type Target = { kind: "form"; index?: number } | { kind: "remove"; index: number };

export interface HolidaysCardProps {
  holidays: readonly HolidayEntry[];
  canEdit: boolean;
}

/**
 * The school's holidays in date order: each one's name, its days and the campus it closes
 * (blank is every campus). Add, Edit and Remove each `PUT` the whole list with the one change,
 * since the calendar is one document, not a collection. Each dialog is mounted only while open.
 */
export function HolidaysCard({ holidays, canEdit }: HolidaysCardProps) {
  const t = useTranslations("school");
  const locale = useLocale();
  const campusesQuery = useCampuses();
  const [target, setTarget] = useState<Target | null>(null);

  const campusName = (campusId: string | null | undefined) =>
    campusId
      ? (campusesQuery.data?.find((campus) => campus.id === campusId)?.name ?? t("unknownCampus"))
      : t("allCampuses");

  function days(entry: HolidayEntry): string {
    const start = formatDate(entry.start_date, locale);
    const end = entry.end_date ?? entry.start_date;
    return end === entry.start_date
      ? start
      : t("calendar.holidays.range", { start, end: formatDate(end, locale) });
  }

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };
  const removing = target?.kind === "remove" ? holidays[target.index] : undefined;

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("calendar.holidays.title")}</CardTitle>
            <CardDescription>{t("calendar.holidays.description")}</CardDescription>
          </CardHeading>
          {canEdit ? (
            <CardToolbar>
              <Button
                variant="primary"
                onClick={() => {
                  setTarget({ kind: "form" });
                }}
              >
                <Plus aria-hidden="true" />
                {t("calendar.holidays.create")}
              </Button>
            </CardToolbar>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {holidays.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title={t("calendar.holidays.emptyTitle")}
              description={t("calendar.holidays.emptyDescription")}
            />
          ) : (
            <Table>
              <TableCaption className="sr-only">{t("calendar.holidays.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.name")}</TableHead>
                  <TableHead>{t("calendar.holidays.days")}</TableHead>
                  <TableHead>{t("fields.campus")}</TableHead>
                  {canEdit && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidaysByDate(holidays).map(({ entry, index }) => (
                  <TableRow key={`${entry.start_date}-${String(index)}`}>
                    <TableCell className="font-medium">{entry.name}</TableCell>
                    <TableCell>{days(entry)}</TableCell>
                    <TableCell>{campusName(entry.campus_id)}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <RowEditRemoveActions
                          editLabel={t("actions.editRow", { name: entry.name })}
                          onEdit={() => {
                            setTarget({ kind: "form", index });
                          }}
                          removeLabel={t("actions.removeRow", { name: entry.name })}
                          onRemove={() => {
                            setTarget({ kind: "remove", index });
                          }}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {target?.kind === "form" && (
        <HolidayFormDialog open onOpenChange={close} holidays={holidays} index={target.index} />
      )}
      {target?.kind === "remove" && removing && (
        <RemoveRecordDialog
          open
          onOpenChange={close}
          name={removing.name}
          description={t("calendar.holidays.removeDescription")}
          remove={() =>
            Services.schoolOrganization.updateHolidayCalendar({
              holidays: withoutHoliday(holidays, target.index),
            })
          }
        />
      )}
    </>
  );
}
