import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { SubstitutionsTable } from "@/features/timetable/substitutions/substitutions-table";
import { SubstitutionsToolbar } from "@/features/timetable/substitutions/substitutions-toolbar";

// The tab bar and sidebar show this section to a proposer or an approver of cover, and the
// API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense boundary.
export default function SubstitutionsPage() {
  return (
    <>
      <Container>
        <SubstitutionsToolbar />
      </Container>
      <Container>
        <Suspense>
          <SubstitutionsTable />
        </Suspense>
      </Container>
    </>
  );
}
