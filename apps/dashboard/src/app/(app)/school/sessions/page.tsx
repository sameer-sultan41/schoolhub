import { Container } from "@/app/(app)/shell/partials/common/container";
import { SessionsSection } from "@/features/school/sessions/sessions-section";

// The tab bar and sidebar show this section to a holder of a session write key; the API enforces.
export default function SchoolSessionsPage() {
  return (
    <Container>
      <SessionsSection />
    </Container>
  );
}
