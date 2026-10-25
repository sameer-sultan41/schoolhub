import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { RecordsTable } from "@/features/attendance/records/records-table";
import { RecordsToolbar } from "@/features/attendance/records/records-toolbar";

// The tab bar and sidebar show this section to a holder of `attendance.student-attendance.view`,
// and the API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary.
export default function AttendanceRecordsPage() {
  return (
    <>
      <Container>
        <RecordsToolbar />
      </Container>
      <Container>
        <Suspense>
          <RecordsTable />
        </Suspense>
      </Container>
    </>
  );
}
