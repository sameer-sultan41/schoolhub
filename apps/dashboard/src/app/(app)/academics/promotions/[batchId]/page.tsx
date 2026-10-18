import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PromotionBatchReview } from "@/features/academics/promotions/promotion-batch-review";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a batch, so it
// is a 404 here rather than a request the API would refuse. The review is keyed by its batch, so
// one batch's execution and dialogs never carry over to another.
export default async function PromotionBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  if (!isUuid(batchId)) notFound();

  return (
    <Container>
      <PromotionBatchReview key={batchId} batchId={batchId} />
    </Container>
  );
}
