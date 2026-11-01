import { Container } from "@/app/(app)/shell/partials/common/container";
import { BroadcastScreen } from "@/features/communication/broadcast/broadcast-screen";

// The tab bar and sidebar show this section to a holder of `communication.broadcast.send`, and
// the API enforces.
export default function CommunicationBroadcastPage() {
  return (
    <Container>
      <BroadcastScreen />
    </Container>
  );
}
