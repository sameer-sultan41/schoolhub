"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";
import { useCampuses } from "@/hooks/use-reference-data";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type ClassRecord, type SectionRecord } from "@/services";
import {
  CLASS_SECTIONS_RESOURCE,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import { SectionFormDialog } from "./section-form-dialog";

export interface SectionPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/** Which dialog is open: `{ kind: "form" }` adds a section, with `record` it edits one. */
type DialogTarget =
  { kind: "form"; record?: SectionRecord } | { kind: "remove"; record: SectionRecord };

/**
 * A class's sections, by name, inside its expanded row: each one's campus, seats and status,
 * with Add, Edit and Remove on the section keys. The server refuses a new or edited section in
 * an inactive class (`SectionSerializer.validate`), so that class's sections are only listed and
 * removed.
 */
export function ClassSectionsPanel({
  schoolClass,
  permissions,
}: {
  schoolClass: ClassRecord;
  permissions: SectionPermissions;
}) {
  const t = useTranslations("school");
  const tErrors = useTranslations("errors");
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const campusesQuery = useCampuses();
  const sectionsQuery = useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, CLASS_SECTIONS_RESOURCE, {
      classId: schoolClass.id,
    }),
    queryFn: () => Services.schoolOrganization.fetchClassSections(schoolClass.id),
  });

  const isInactive = schoolClass.is_active === false;
  const showCreate = permissions.canCreate && !isInactive;
  const showEdit = permissions.canUpdate && !isInactive;
  const showActions = showEdit || permissions.canDelete;
  const sections = sectionsQuery.data ?? [];

  const campusName = (campusId: string) =>
    campusesQuery.data?.find((campus) => campus.id === campusId)?.name ?? t("unknownCampus");

  if (sectionsQuery.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(sectionsQuery.error, tErrors, t("sections.loadError"))}
        onRetry={() => {
          void sectionsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {isInactive ? t("sections.inactiveClass") : t("sections.summary")}
        </p>
        {showCreate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDialog({ kind: "form" });
            }}
          >
            <Plus aria-hidden="true" />
            {t("sections.actions.create")}
          </Button>
        )}
      </div>
      {sectionsQuery.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : sections.length === 0 ? (
        <p className="text-sm">{t("sections.empty")}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">
            {t("sections.caption", { name: schoolClass.name })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name")}</TableHead>
              <TableHead>{t("fields.campus")}</TableHead>
              <TableHead>{t("sections.fields.capacity")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              {showActions && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) => (
              <TableRow key={section.id}>
                <TableCell className="font-medium">{section.name}</TableCell>
                <TableCell>{campusName(section.campus_id)}</TableCell>
                <TableCell>
                  {section.capacity == null ? t("sections.unlimited") : section.capacity}
                </TableCell>
                <TableCell>
                  <StructureStatusBadge isActive={section.is_active} />
                </TableCell>
                {showActions && (
                  <TableCell>
                    <RowEditRemoveActions
                      editLabel={
                        showEdit ? t("actions.editRow", { name: section.name }) : undefined
                      }
                      onEdit={() => {
                        setDialog({ kind: "form", record: section });
                      }}
                      removeLabel={
                        permissions.canDelete
                          ? t("actions.removeRow", { name: section.name })
                          : undefined
                      }
                      onRemove={() => {
                        setDialog({ kind: "remove", record: section });
                      }}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {dialog?.kind === "form" && (
        <SectionFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          classId={schoolClass.id}
          record={dialog.record}
        />
      )}
      {dialog?.kind === "remove" && (
        <RemoveRecordDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          name={t("sections.qualifiedName", {
            className: schoolClass.name,
            name: dialog.record.name,
          })}
          remove={() => Services.schoolOrganization.deleteSection(dialog.record.id)}
        />
      )}
    </div>
  );
}
