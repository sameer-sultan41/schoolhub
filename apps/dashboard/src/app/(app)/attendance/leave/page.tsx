import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { LeaveTable } from "@/features/attendance/leave/leave-table";
import { LeaveToolbar } from "@/features/attendance/leave/leave-toolbar";

// The tab bar and sidebar show this section to a holder of `attendance.leave-request.view`, and
// the API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary.
export default function AttendanceLeavePage() {
  return (
    <>
      <Container>
        <LeaveToolbar />
      </Container>
      <Container>
        <Suspense>
          <LeaveTable />
        </Suspense>
      </Container>
    </>
  );
}
