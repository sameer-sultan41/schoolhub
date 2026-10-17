import { Container } from "@/app/(app)/shell/partials/common/container";
import { AcademicsLanding } from "@/features/academics/academics-landing";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function AcademicsPage() {
  return (
    <Container>
      <AcademicsLanding />
    </Container>
  );
}
