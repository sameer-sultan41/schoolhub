import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { CorrectionsTable } from "@/features/attendance/corrections/corrections-table";
import { CorrectionsToolbar } from "@/features/attendance/corrections/corrections-toolbar";

// The tab bar and sidebar show this section to a holder of `attendance.correction.create` or
// `.approve`, and the API enforces. The table reads the URL (`useSearchParams`), so it sits in a
// Suspense boundary.
export default function AttendanceCorrectionsPage() {
  return (
    <>
      <Container>
        <CorrectionsToolbar />
      </Container>
      <Container>
        <Suspense>
          <CorrectionsTable />
        </Suspense>
      </Container>
    </>
  );
}
