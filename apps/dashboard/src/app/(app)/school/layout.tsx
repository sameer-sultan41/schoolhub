import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { SCHOOL_SECTIONS } from "@/features/school/school-sections";

// Every School section sits under the same tab bar; the bar shows only the sections the viewer
// may open (see `school-sections.ts`).
export default function SchoolLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={SCHOOL_SECTIONS} namespace="school" />
      </Container>
      {children}
    </>
  );
}
