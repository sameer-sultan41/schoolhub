import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { StaffAttendanceScreen } from "@/features/attendance/staff/staff-attendance-screen";

// The tab bar and sidebar show this section to a holder of `attendance.staff-attendance.view`,
// and the API enforces. The screen reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary.
export default function AttendanceStaffPage() {
  return (
    <Container>
      <Suspense>
        <StaffAttendanceScreen />
      </Suspense>
    </Container>
  );
}
