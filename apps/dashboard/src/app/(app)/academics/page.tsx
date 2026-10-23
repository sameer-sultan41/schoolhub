import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ACADEMICS_SECTIONS } from "@/features/academics/academics-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function AcademicsPage() {
  return (
    <Container>
      <ModuleLanding sections={ACADEMICS_SECTIONS} />
    </Container>
  );
}
