import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ReportsSection } from "@/features/platform/reports/reports-section";

// Shown to a holder of `platform.report.view`; the API enforces. The chosen report is in the URL,
// so the section sits in a Suspense boundary.
export default function PlatformReportsPage() {
  return (
    <Container>
      <Suspense>
        <ReportsSection />
      </Suspense>
    </Container>
  );
}
