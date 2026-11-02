import { Container } from "@/app/(app)/shell/partials/common/container";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { COMMUNICATION_SECTIONS } from "@/features/communication/communication-sections";

// No page of its own: the client-side landing sends the viewer to their first permitted section.
export default function CommunicationPage() {
  return (
    <Container>
      <ModuleLanding sections={COMMUNICATION_SECTIONS} />
    </Container>
  );
}
