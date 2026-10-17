import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { CurriculumTable } from "@/features/academics/curriculum/curriculum-table";
import { CurriculumToolbar } from "@/features/academics/curriculum/curriculum-toolbar";

// No page-level authorization check of its own, like every route in this app: the sidebar and
// tab bar hide the section from a viewer without `academics.curriculum.view`, and the API
// enforces. The toolbar and the table are the client pieces, and both read the URL
// (`useSearchParams`: the toolbar the `session`, the table the whole list state), so each sits
// in its own Suspense boundary: Next fails a production build for one without.
export default function CurriculumPage() {
  return (
    <>
      <Container>
        <Suspense>
          <CurriculumToolbar />
        </Suspense>
      </Container>
      <Container>
        <Suspense>
          <CurriculumTable />
        </Suspense>
      </Container>
    </>
  );
}
