"use client";

import { Suspense } from "react";

import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { EXAMS_SECTIONS } from "@/features/exams/exams-sections";
import { ExamsTable } from "./exams-table";
import { ExamsToolbar } from "./exams-toolbar";

/**
 * `/exams` plays two roles. A holder of `exams.exam.view` gets the exams list; anyone else is
 * sent to the first Examinations section they may open (the landing), which never picks Exams
 * for them, so the two cannot redirect in a circle. The viewer is known only client-side (the
 * session is an in-memory token), so the landing's own message covers the wait.
 */
export function ExamsHome() {
  const { data: user } = useCurrentUser();

  if (!hasPermission(user, "exams.exam.view")) {
    return (
      <Container>
        <ModuleLanding sections={EXAMS_SECTIONS} />
      </Container>
    );
  }

  return (
    <>
      <Container>
        <ExamsToolbar />
      </Container>
      <Container>
        {/* The table reads the URL (`useSearchParams`): Next fails a production build without a boundary. */}
        <Suspense>
          <ExamsTable />
        </Suspense>
      </Container>
    </>
  );
}
