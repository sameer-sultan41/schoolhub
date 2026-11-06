import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ExamReportsScreen } from "@/features/exams/reports/exam-reports-screen";

// The tab bar and sidebar show this section to a holder of `exams.result.view`, and the API
// enforces. The screen reads the URL (`useSearchParams`), so it sits in a Suspense boundary: Next
// fails a production build for one without.
export default function ExamReportsPage() {
  return (
    <Container>
      <Suspense>
        <ExamReportsScreen />
      </Suspense>
    </Container>
  );
}
