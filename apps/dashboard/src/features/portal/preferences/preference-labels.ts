import type { NotificationChannel } from "@/services";

/** Every channel to its message key under `portal.preferences` (L32: exhaustive). */
export const NOTIFICATION_CHANNEL_LABEL_KEY: Record<
  NotificationChannel,
  `channels.${NotificationChannel}`
> = {
  email: "channels.email",
  sms: "channels.sms",
  push: "channels.push",
  in_app: "channels.in_app",
  whatsapp: "channels.whatsapp",
};
