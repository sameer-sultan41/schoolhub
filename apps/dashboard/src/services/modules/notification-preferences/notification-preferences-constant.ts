import type { NotificationChannel } from "./notification-preferences-type";

/** The query-key module the preferences matrix lives under. */
export const NOTIFICATION_PREFERENCES_QUERY_MODULE = "notification-preferences";

/** Every channel, in display order. A `Record` over the generated enum, so a new member fails
 * to compile until it is listed here. */
const CHANNEL_ORDER: Record<NotificationChannel, true> = {
  in_app: true,
  email: true,
  sms: true,
  push: true,
  whatsapp: true,
};

function isChannel(key: string): key is NotificationChannel {
  return key in CHANNEL_ORDER;
}

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] =
  Object.keys(CHANNEL_ORDER).filter(isChannel);

/** The category that is never gated, on any channel (the server's emergency floor). */
export const LOCKED_CATEGORY = "emergency";
