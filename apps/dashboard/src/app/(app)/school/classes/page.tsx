import { Container } from "@/app/(app)/shell/partials/common/container";
import { ClassesSection } from "@/features/school/classes/classes-section";

// The tab bar and sidebar show this section to a holder of a class or section write key; the API
// enforces.
export default function SchoolClassesPage() {
  return (
    <Container>
      <ClassesSection />
    </Container>
  );
}
