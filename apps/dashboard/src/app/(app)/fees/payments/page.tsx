import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PaymentsHome } from "@/features/fees/payments/payments-home";

// The tab bar and sidebar hide this section from a viewer without `fees.payment.view`, which is
// also the key all five sub-tabs read behind, and the API enforces. The page reads the URL
// (`useSearchParams`: its tab and list filters), so it sits in a Suspense boundary: Next fails a
// production build for one without.
export default function FeePaymentsPage() {
  return (
    <Container>
      <Suspense>
        <PaymentsHome />
      </Suspense>
    </Container>
  );
}
