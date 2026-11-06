import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { FEES_SECTIONS } from "@/features/fees/fees-sections";

// Every Fees & Finance section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `fees-sections.ts`).
export default function FeesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={FEES_SECTIONS} namespace="fees" />
      </Container>
      {children}
    </>
  );
}
