import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { ACADEMICS_SECTIONS } from "@/features/academics/academics-sections";

// Every Academics section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `academics-sections.ts`).
export default function AcademicsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={ACADEMICS_SECTIONS} namespace="academics" />
      </Container>
      {children}
    </>
  );
}
