import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { InvoicesHome } from "@/features/fees/invoices/invoices-home";

// The tab bar and sidebar hide this section from a viewer without `fees.invoice.view`, and the
// API enforces. The page reads the URL (`useSearchParams`: its list filters), so it sits in a
// Suspense boundary: Next fails a production build for one without.
export default function FeeInvoicesPage() {
  return (
    <Container>
      <Suspense>
        <InvoicesHome />
      </Suspense>
    </Container>
  );
}
