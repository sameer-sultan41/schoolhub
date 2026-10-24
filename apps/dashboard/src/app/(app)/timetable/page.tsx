import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { TIMETABLE_SECTIONS } from "@/features/timetable/timetable-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function TimetablePage() {
  return (
    <Container>
      <ModuleLanding sections={TIMETABLE_SECTIONS} />
    </Container>
  );
}
