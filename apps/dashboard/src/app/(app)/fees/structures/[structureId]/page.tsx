import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { StructurePage } from "@/features/fees/structures/detail/structure-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a structure, so
// it is a 404 here rather than a request the API would refuse. The page is keyed by its
// structure, so one structure's dialogs never carry over to another. It sits in a Suspense
// boundary because the header's children read the URL.
export default async function FeeStructureDetailPage({
  params,
}: {
  params: Promise<{ structureId: string }>;
}) {
  const { structureId } = await params;
  if (!isUuid(structureId)) notFound();

  return (
    <Container>
      <Suspense>
        <StructurePage key={structureId} structureId={structureId} />
      </Suspense>
    </Container>
  );
}
