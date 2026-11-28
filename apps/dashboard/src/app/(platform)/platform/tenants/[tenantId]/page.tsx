import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { TenantDetail } from "@/features/platform/tenants/tenant-detail";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a school, so it
// is a 404 here. Keyed by the school, so one school's dialogs never carry over to another. The
// detail reads its tab from the URL, so it sits in a Suspense boundary.
export default async function PlatformTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  if (!isUuid(tenantId)) notFound();

  return (
    <Container>
      <Suspense>
        <TenantDetail key={tenantId} tenantId={tenantId} />
      </Suspense>
    </Container>
  );
}
