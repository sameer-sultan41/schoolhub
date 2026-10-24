import { Container } from "@/app/(app)/shell/partials/common/container";
import { AttendanceSettingsForm } from "@/features/attendance/settings/attendance-settings-form";

// The tab bar and sidebar show this section to a viewer holding `school.settings.update`, and
// the API enforces (`school.settings.view` reads, `.update` writes).
export default function AttendanceSettingsPage() {
  return (
    <Container>
      <AttendanceSettingsForm />
    </Container>
  );
}
