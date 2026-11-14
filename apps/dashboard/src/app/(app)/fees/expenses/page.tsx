import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ExpensesHome } from "@/features/fees/expenses/expenses-home";

// The tab bar and sidebar hide this section from a viewer without `fees.expense.view`, and the
// API enforces. The page reads the URL (`useSearchParams`: its tab and list filters), so it sits
// in a Suspense boundary: Next fails a production build for one without.
export default function ExpensesPage() {
  return (
    <Container>
      <Suspense>
        <ExpensesHome />
      </Suspense>
    </Container>
  );
}
