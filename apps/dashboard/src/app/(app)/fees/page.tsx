import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { FEES_SECTIONS } from "@/features/fees/fees-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function FeesPage() {
  return (
    <Container>
      <ModuleLanding sections={FEES_SECTIONS} />
    </Container>
  );
}
