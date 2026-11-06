import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { ExamPage } from "@/features/exams/detail/exam-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name an exam, so it
// is a 404 here rather than a request the API would refuse. The page is keyed by its exam, so one
// exam's tab and dialogs never carry over to another. `ExamPage` reads the URL (`?tab=`), so it
// sits in a Suspense boundary: Next fails a production build for one without.
export default async function ExamDetailPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!isUuid(examId)) notFound();

  return (
    <Container>
      <Suspense>
        <ExamPage key={examId} examId={examId} />
      </Suspense>
    </Container>
  );
}
