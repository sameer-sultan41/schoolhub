import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { EXAMS_SECTIONS } from "@/features/exams/exams-sections";

// Every Examinations section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `exams-sections.ts`).
export default function ExamsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />
      </Container>
      {children}
    </>
  );
}
