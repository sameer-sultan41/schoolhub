import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { WEBSITE_SECTIONS } from "@/features/website/website-sections";

// Every Website section sits under the same tab bar; the bar shows only the sections the
// viewer may open (see `website-sections.ts`).
export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={WEBSITE_SECTIONS} namespace="website" />
      </Container>
      {children}
    </>
  );
}
