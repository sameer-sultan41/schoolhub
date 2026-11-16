import { Container } from "@/app/(app)/shell/partials/common/container";
import { ProfileSection } from "@/features/school/profile/profile-section";

// The tab bar and sidebar show this section to a holder of `school.settings.update`; the API enforces.
export default function SchoolProfilePage() {
  return (
    <Container>
      <ProfileSection />
    </Container>
  );
}
