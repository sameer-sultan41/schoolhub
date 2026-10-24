import { Container } from "@/app/(app)/shell/partials/common/container";
import { MyTimetable } from "@/features/timetable/my/my-timetable";

// Every tenant role holds `timetable.timetable.view`; the API answers with the viewer's own
// week (a teacher's classes, a learner's section) and never a draft.
export default function MyTimetablePage() {
  return (
    <Container>
      <MyTimetable />
    </Container>
  );
}
