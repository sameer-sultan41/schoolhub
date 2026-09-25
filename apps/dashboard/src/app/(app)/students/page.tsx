import { Container } from "@/app/(app)/shell/partials/common/container";
import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";

// Placeholder: the Students module's real screens (directory, add/edit) aren't built
// yet — this route exists so menu-config.ts's "Students" entry is a genuine link a
// permission-holding user can follow, not a dead href. Same thin shell as every other
// route here: the title resolves from menu-config.ts, same as staff/page.tsx.
export default function StudentsPage() {
  return (
    <Container>
      <Toolbar>
        <ToolbarHeading />
      </Toolbar>
      <p className="text-sm text-muted-foreground">Coming soon.</p>
    </Container>
  );
}
