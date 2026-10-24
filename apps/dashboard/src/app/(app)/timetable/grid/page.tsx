import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { TimetableGridScreen } from "@/features/timetable/grid/timetable-grid-screen";

// The tab bar and sidebar hide this section from a viewer without `timetable.slot.view`, and
// the API enforces. The screen reads its session, class and section from the URL
// (`useSearchParams`), so it sits in a Suspense boundary.
export default function TimetableGridPage() {
  return (
    <Container>
      <Suspense>
        <TimetableGridScreen />
      </Suspense>
    </Container>
  );
}
