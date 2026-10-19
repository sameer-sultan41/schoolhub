import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { TIMETABLE_SECTIONS } from "@/features/timetable/timetable-sections";

// Every Timetable section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `timetable-sections.ts`).
export default function TimetableLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={TIMETABLE_SECTIONS} namespace="timetable" />
      </Container>
      {children}
    </>
  );
}
