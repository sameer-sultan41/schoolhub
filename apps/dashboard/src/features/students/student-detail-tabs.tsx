"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent } from "@schoolhub/ui";

import { ResponsiveSheetBody } from "@/components/responsive-dialog";
import { ResponsiveTabsList, type ResponsiveTabItem } from "@/components/responsive-tabs-list";
import { hasPermission } from "@/lib/permissions";
import type { AuthenticatedUser } from "@schoolhub/types";
import type { StudentEnrollmentTabPermissions } from "./student-enrollment-tab";
import { StudentDocumentsTab } from "./student-documents-tab";
import { StudentEmergencyContactsTab } from "./student-emergency-contacts-tab";
import { StudentEnrollmentTab } from "./student-enrollment-tab";
import { StudentGuardiansTab } from "./student-guardians-tab";

export interface StudentDetailTabsProps {
  studentId: string;
  /** The Profile tab's own body — built by the caller from `FieldRow`/`FieldSection`,
   * which stay private to `student-detail-sheet.tsx` rather than being exported just for
   * this one consumer. */
  profileContent: ReactNode;
  currentUser: AuthenticatedUser | undefined;
  canViewGuardians: boolean;
  canViewEmergencyContacts: boolean;
  canViewDocuments: boolean;
  canViewEnrollment: boolean;
  enrollmentPermissions: StudentEnrollmentTabPermissions;
  /** Required for the enrollment tab only — the caller only renders this component with
   * `canViewEnrollment` true once the detail record (and so the campus id) has loaded. */
  campusId: string | undefined;
  /** Controlled rather than locally owned — `student-detail-sheet.tsx` needs to know
   * which tab is showing so its Edit button can open `StudentCreateStepper` landed on
   * the same one. */
  activeTab: string;
  onActiveTabChange: (tab: string) => void;
}

/**
 * Owns the sheet's tab content, separately from `student-detail-sheet.tsx`'s
 * header/footer chrome — both so that file stays under the repo's max-lines budget and so
 * this component can be remounted fresh per student via `key={row.id}` at its call site,
 * the same reset-on-row-change trick the single `<Tabs defaultValue>` it replaces used to
 * rely on. `Tabs` is controlled (`value`/`onValueChange`) rather than `defaultValue`
 * because `ResponsiveTabsList`'s "More" dropdown needs to programmatically switch to a
 * tab that's currently hidden off to the side — not possible against an uncontrolled
 * `Tabs`, which only Radix's own trigger clicks can drive. `activeTab` itself now lives
 * in `student-detail-sheet.tsx` for the same reason — the Edit button it owns needs to
 * read it too.
 */
export function StudentDetailTabs({
  studentId,
  profileContent,
  currentUser,
  canViewGuardians,
  canViewEmergencyContacts,
  canViewDocuments,
  canViewEnrollment,
  enrollmentPermissions,
  campusId,
  activeTab,
  onActiveTabChange,
}: StudentDetailTabsProps) {
  const t = useTranslations("students");

  const items: ResponsiveTabItem[] = [
    { value: "profile", label: t("tabs.profile") },
    ...(canViewGuardians ? [{ value: "guardians", label: t("tabs.guardians") }] : []),
    ...(canViewEmergencyContacts
      ? [{ value: "emergencyContacts", label: t("tabs.emergencyContacts") }]
      : []),
    ...(canViewDocuments ? [{ value: "documents", label: t("tabs.documents") }] : []),
    ...(canViewEnrollment ? [{ value: "enrollment", label: t("tabs.history") }] : []),
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={onActiveTabChange}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ResponsiveTabsList
        items={items}
        value={activeTab}
        onValueChange={onActiveTabChange}
        moreLabel={t("tabs.more")}
        className="relative shrink-0 border-b border-border"
      />

      <TabsContent value="profile" className="flex min-h-0 flex-1 flex-col">
        <ResponsiveSheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {profileContent}
        </ResponsiveSheetBody>
      </TabsContent>

      {canViewGuardians && (
        <TabsContent value="guardians" className="flex min-h-0 flex-1 flex-col">
          <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
            <StudentGuardiansTab
              studentId={studentId}
              canCreate={hasPermission(currentUser, "students.guardian.create")}
              canUpdate={hasPermission(currentUser, "students.guardian.update")}
            />
          </ResponsiveSheetBody>
        </TabsContent>
      )}

      {canViewEmergencyContacts && (
        <TabsContent value="emergencyContacts" className="flex min-h-0 flex-1 flex-col">
          <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
            <StudentEmergencyContactsTab
              studentId={studentId}
              canCreate={hasPermission(currentUser, "students.student.update")}
            />
          </ResponsiveSheetBody>
        </TabsContent>
      )}

      {canViewDocuments && (
        <TabsContent value="documents" className="flex min-h-0 flex-1 flex-col">
          <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
            <StudentDocumentsTab
              studentId={studentId}
              canCreate={hasPermission(currentUser, "students.document.create")}
              canVerify={hasPermission(currentUser, "students.document.verify")}
              canDelete={hasPermission(currentUser, "students.document.delete")}
            />
          </ResponsiveSheetBody>
        </TabsContent>
      )}

      {canViewEnrollment && campusId && (
        <TabsContent value="enrollment" className="flex min-h-0 flex-1 flex-col">
          <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
            <StudentEnrollmentTab
              studentId={studentId}
              campusId={campusId}
              permissions={enrollmentPermissions}
            />
          </ResponsiveSheetBody>
        </TabsContent>
      )}
    </Tabs>
  );
}
