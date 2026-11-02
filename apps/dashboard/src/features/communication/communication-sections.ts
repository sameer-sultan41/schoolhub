import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Communication sections, in tab order: tabs, the `/communication` landing and
 * the sidebar's children all derive from it. Each tab is gated on the key its screen needs, so
 * a viewer lands on the first screen they may open.
 */
export const COMMUNICATION_SECTIONS = [
  {
    href: Paths.COMMUNICATION_MESSAGES,
    labelKey: "nav.messages",
    menuTitle: "Messages",
    permission: "communication.thread.view",
  },
  {
    href: Paths.COMMUNICATION_OVERSIGHT,
    labelKey: "nav.oversight",
    menuTitle: "Oversight",
    permission: "communication.thread.oversee",
  },
  {
    href: Paths.COMMUNICATION_BROADCAST,
    labelKey: "nav.broadcast",
    menuTitle: "Broadcast",
    permission: "communication.broadcast.send",
  },
] as const satisfies readonly ModuleSection[];
