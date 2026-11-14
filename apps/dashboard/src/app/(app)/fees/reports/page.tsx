import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ReportsHome } from "@/features/fees/reports/reports-home";

// The tab bar and sidebar hide this section from a viewer without `fees.report.view`, and the API
// enforces. The page reads the URL (`useSearchParams`: its report and filters), so it sits in a
// Suspense boundary: Next fails a production build for one without.
export default function ReportsPage() {
  return (
    <Container>
      <Suspense>
        <ReportsHome />
      </Suspense>
    </Container>
  );
}
