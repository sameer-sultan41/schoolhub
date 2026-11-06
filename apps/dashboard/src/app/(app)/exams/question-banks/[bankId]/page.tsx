import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { BankPage } from "@/features/exams/question-banks/bank-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a bank, so it
// is a 404 here rather than a request the API would refuse. The page is keyed by its bank, so one
// bank's filters and dialogs never carry over to another. `BankPage` reads the URL (its question
// filters), so it sits in a Suspense boundary: Next fails a production build for one without.
export default async function QuestionBankDetailPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  if (!isUuid(bankId)) notFound();

  return (
    <Container>
      <Suspense>
        <BankPage key={bankId} bankId={bankId} />
      </Suspense>
    </Container>
  );
}
