import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PromotionBatchTable } from "@/features/academics/promotions/promotion-batch-table";
import { PromotionBatchToolbar } from "@/features/academics/promotions/promotion-batch-toolbar";

// The table reads the URL (`useSearchParams`), so it needs its own Suspense; the toolbar doesn't.
export default function PromotionsPage() {
  return (
    <>
      <Container>
        <PromotionBatchToolbar />
      </Container>
      <Container>
        <Suspense>
          <PromotionBatchTable />
        </Suspense>
      </Container>
    </>
  );
}
