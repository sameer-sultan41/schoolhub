import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { ATTENDANCE_SECTIONS } from "@/features/attendance/attendance-sections";

// Every Attendance section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `attendance-sections.ts`).
export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />
      </Container>
      {children}
    </>
  );
}
