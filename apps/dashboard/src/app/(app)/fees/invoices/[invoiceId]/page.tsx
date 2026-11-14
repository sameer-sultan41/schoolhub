import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { InvoicePage } from "@/features/fees/invoices/detail/invoice-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name an invoice, so
// it is a 404 here rather than a request the API would refuse. The page is keyed by its invoice,
// so one invoice's dialogs never carry over to another.
export default async function FeeInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  if (!isUuid(invoiceId)) notFound();

  return (
    <Container>
      <Suspense>
        <InvoicePage key={invoiceId} invoiceId={invoiceId} />
      </Suspense>
    </Container>
  );
}
