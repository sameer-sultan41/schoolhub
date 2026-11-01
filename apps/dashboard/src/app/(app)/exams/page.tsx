import { Container } from "@/app/(app)/shell/partials/common/container";
import { ExamsHome } from "@/features/exams/list/exams-home";

// The exams list for a holder of `exams.exam.view`, else the landing redirect: see `ExamsHome`.
export default function ExamsPage() {
  return (
    <Container>
      <ExamsHome />
    </Container>
  );
}
