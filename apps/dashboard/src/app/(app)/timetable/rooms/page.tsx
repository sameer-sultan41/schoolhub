import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { RoomsTable } from "@/features/timetable/rooms/rooms-table";
import { RoomsToolbar } from "@/features/timetable/rooms/rooms-toolbar";

// The tab bar and sidebar hide this section from a viewer without `timetable.room.update`,
// and the API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function RoomsPage() {
  return (
    <>
      <Container>
        <RoomsToolbar />
      </Container>
      <Container>
        <Suspense>
          <RoomsTable />
        </Suspense>
      </Container>
    </>
  );
}
