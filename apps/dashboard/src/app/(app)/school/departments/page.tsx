import { Container } from "@/app/(app)/shell/partials/common/container";
import { DepartmentsSection } from "@/features/school/departments/departments-section";

// The tab bar and sidebar show this section to a holder of a department write key; the API enforces.
export default function SchoolDepartmentsPage() {
  return (
    <Container>
      <DepartmentsSection />
    </Container>
  );
}
