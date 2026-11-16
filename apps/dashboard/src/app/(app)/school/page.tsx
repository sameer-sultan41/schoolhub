import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { SCHOOL_SECTIONS } from "@/features/school/school-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function SchoolPage() {
  return (
    <Container>
      <ModuleLanding sections={SCHOOL_SECTIONS} />
    </Container>
  );
}
