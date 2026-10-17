import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { AcademicsNav } from "@/features/academics/academics-nav";

// Every Academics section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `academics-sections.ts`).
export default function AcademicsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <AcademicsNav />
      </Container>
      {children}
    </>
  );
}
