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
        <StudentToolbar />
      </Container>
      <Container>
        <StudentDirectoryTable />
      </Container>
    </>
  );
}
