import { Container } from "@/app/(app)/shell/partials/common/container";
import { CalendarSection } from "@/features/school/calendar/calendar-section";

// The tab bar and sidebar show this section to a holder of `school.settings.update`; the API enforces.
export default function SchoolCalendarPage() {
  return (
    <Container>
      <CalendarSection />
    </Container>
  );
}
