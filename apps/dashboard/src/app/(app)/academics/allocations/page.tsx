import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { AllocationTable } from "@/features/academics/allocations/allocation-table";
import { AllocationToolbar } from "@/features/academics/allocations/allocation-toolbar";

// The toolbar and the table each read the URL (`useSearchParams`), so each needs its own Suspense.
export default function AllocationsPage() {
  return (
    <>
      <Container>
        <Suspense>
          <AllocationToolbar />
        </Suspense>
      </Container>
      <Container>
        <Suspense>
          <AllocationTable />
        </Suspense>
      </Container>
    </>
  );
}
