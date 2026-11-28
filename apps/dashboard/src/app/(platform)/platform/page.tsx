import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { PLATFORM_SECTIONS } from "@/features/platform/platform-sections";

// An operator's home: the client-side landing sends them to the first section they may open.
export default function PlatformPage() {
  return (
    <Container>
      <ModuleLanding sections={PLATFORM_SECTIONS} />
    </Container>
  );
}
