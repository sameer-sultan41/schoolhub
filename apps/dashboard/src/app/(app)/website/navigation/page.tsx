import { Container } from "@/app/(app)/shell/partials/common/container";
import { NavigationEditor } from "@/features/website/navigation/navigation-editor";

// The header and footer menus. The tab bar and sidebar show this section only with
// `website.navigation.update`, and the API enforces it.
export default function WebsiteNavigationPage() {
  return (
    <Container>
      <NavigationEditor />
    </Container>
  );
}
