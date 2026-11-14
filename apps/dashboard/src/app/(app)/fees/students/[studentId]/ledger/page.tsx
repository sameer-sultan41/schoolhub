import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { StatementPage } from "@/features/fees/statement/statement-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a student, so
// it is a 404 here rather than a request the API would refuse. Keyed by the student so one
// student's table paging never carries over to another's.
export default async function StudentStatementRoute({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  if (!isUuid(studentId)) notFound();

  return (
    <Container>
      <Suspense>
        <StatementPage key={studentId} studentId={studentId} />
      </Suspense>
    </Container>
  );
}
