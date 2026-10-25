import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ATTENDANCE_SECTIONS } from "@/features/attendance/attendance-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function AttendancePage() {
  return (
    <Container>
      <ModuleLanding sections={ATTENDANCE_SECTIONS} />
    </Container>
  );
}
