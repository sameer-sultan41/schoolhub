import { Container } from "@/app/(app)/shell/partials/common/container";
import { CounterHome } from "@/features/fees/counter/counter-home";

// The tab bar and sidebar hide this section from a viewer without `fees.payment.collect`, and
// the API enforces. The counter keeps its student in component state, not the URL, so the page
// reads no search params and needs no Suspense boundary.
export default function FeeCounterPage() {
  return (
    <Container>
      <CounterHome />
    </Container>
  );
}
