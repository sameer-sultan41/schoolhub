import { Container } from "@/app/(app)/shell/partials/common/container";
import { CampusesSection } from "@/features/school/campuses/campuses-section";

// The tab bar and sidebar show this section to a holder of a campus write key; the API enforces.
export default function SchoolCampusesPage() {
  return (
    <Container>
      <CampusesSection />
    </Container>
  );
}
