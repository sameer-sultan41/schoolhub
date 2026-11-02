import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { COMMUNICATION_SECTIONS } from "@/features/communication/communication-sections";

// Every Communication section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `communication-sections.ts`).
export default function CommunicationLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={COMMUNICATION_SECTIONS} namespace="communication" />
      </Container>
      {children}
    </>
  );
}
