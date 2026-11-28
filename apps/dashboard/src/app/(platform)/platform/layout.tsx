import type { ReactNode } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { PLATFORM_SECTIONS } from "@/features/platform/platform-sections";

// Every console section sits under the same tab bar, showing only the sections the operator's
// keys open (see `platform-sections.ts`).
export default function PlatformSectionsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Container>
        <ModuleSectionNav sections={PLATFORM_SECTIONS} namespace="platform" />
      </Container>
      {children}
    </>
  );
}
