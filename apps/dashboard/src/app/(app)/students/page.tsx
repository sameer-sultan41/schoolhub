import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { StudentDirectoryTable } from "@/features/students/student-directory-table";
import { StudentToolbar } from "@/features/students/student-toolbar";

// No page-level authorization check of its own — same as every route in this app (see
// staff/page.tsx's identical comment). This stays a plain server component:
// `StudentToolbar` and `StudentDirectoryTable` are the client-side pieces (live stats,
// the table's own queries); the title resolves automatically from menu-config.ts's
// "Students" entry, same as every other route's `ToolbarHeading`.
export default function StudentsPage() {
  return (
    <>
      <Container>
        {/* The toolbar reads `?import=1` (`useSearchParams`), so it gets a boundary too. */}
        <Suspense>
          <StudentToolbar />
        </Suspense>
      </Container>
      <Container>
        {/* The table reads the URL (`useSearchParams`); Next asks for a Suspense boundary
            around that so the route never depends on the layout opting out of prerendering. */}
        <Suspense>
          <StudentDirectoryTable />
        </Suspense>
      </Container>
    </>
  );
}
