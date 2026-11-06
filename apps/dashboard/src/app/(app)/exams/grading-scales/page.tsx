import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { GradingScalesTable } from "@/features/exams/grading-scales/grading-scales-table";
import { GradingScalesToolbar } from "@/features/exams/grading-scales/grading-scales-toolbar";

// The tab bar and sidebar hide this section from a viewer without `exams.grading-scale.view`,
// and the API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function GradingScalesPage() {
  return (
    <>
      <Container>
        <GradingScalesToolbar />
      </Container>
      <Container>
        <Suspense>
          <GradingScalesTable />
        </Suspense>
      </Container>
    </>
  );
}
