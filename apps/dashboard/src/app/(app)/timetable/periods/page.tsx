import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PeriodsTable } from "@/features/timetable/periods/periods-table";
import { PeriodsToolbar } from "@/features/timetable/periods/periods-toolbar";

// The tab bar and sidebar hide this section from a viewer without `timetable.period.update`,
// and the API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function PeriodsPage() {
  return (
    <>
      <Container>
        <PeriodsToolbar />
      </Container>
      <Container>
        <Suspense>
          <PeriodsTable />
        </Suspense>
      </Container>
    </>
  );
}
