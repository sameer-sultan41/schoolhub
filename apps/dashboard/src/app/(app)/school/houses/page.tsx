import { Container } from "@/app/(app)/shell/partials/common/container";
import { HousesSection } from "@/features/school/houses/houses-section";

// The tab bar and sidebar show this section to a holder of a house write key; the API enforces.
export default function SchoolHousesPage() {
  return (
    <Container>
      <HousesSection />
    </Container>
  );
}
