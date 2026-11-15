import { Container } from "@/app/(app)/shell/partials/common/container";
import { SubjectsSection } from "@/features/school/subjects/subjects-section";

// The tab bar and sidebar show this section to a holder of a subject write key; the API enforces.
export default function SchoolSubjectsPage() {
  return (
    <Container>
      <SubjectsSection />
    </Container>
  );
}
