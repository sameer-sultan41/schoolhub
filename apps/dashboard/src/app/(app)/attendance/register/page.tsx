import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { RegisterScreen } from "@/features/attendance/register/register-screen";

// The tab bar and sidebar show this section to a holder of `attendance.student-attendance.mark`,
// and the API enforces. The screen reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary.
export default function AttendanceRegisterPage() {
  return (
    <Container>
      <Suspense>
        <RegisterScreen />
      </Suspense>
    </Container>
  );
}
