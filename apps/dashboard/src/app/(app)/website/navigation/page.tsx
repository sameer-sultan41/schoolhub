import { Container } from "@/app/(app)/shell/partials/common/container";
import { NavigationEditor } from "@/features/website/navigation/navigation-editor";
import { WebsiteReadGate } from "@/features/website/shared/website-read-gate";

// The header and footer menus. The tab bar and sidebar show this section only with
// `website.navigation.update`, and the API enforces it.
// Its reads need `website.page.view`: `WebsiteReadGate` explains instead of reading without it.
export default function WebsiteNavigationPage() {
  return (
    <Container>
      <WebsiteReadGate>
        <NavigationEditor />
      </WebsiteReadGate>
    </Container>
  );
}
