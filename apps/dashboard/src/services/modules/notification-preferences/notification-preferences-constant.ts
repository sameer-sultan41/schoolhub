import type { NotificationChannel } from "./notification-preferences-type";

/** The query-key module the preferences matrix lives under. */
export const NOTIFICATION_PREFERENCES_QUERY_MODULE = "notification-preferences";

/** Every channel the server knows, in display order (the i18n label map is keyed by these). */
export const NOTIFICATION_CHANNELS = [
  "in_app",
  "email",
  "sms",
  "push",
  "whatsapp",
] as const satisfies readonly NotificationChannel[];

/** The channel that is never gated: the inbox itself (`catalog.MANDATORY_CHANNEL`). */
export const MANDATORY_CHANNEL: NotificationChannel = "in_app";

/** The category that is never gated, on any channel (the server's emergency floor). */
export const LOCKED_CATEGORY = "emergency";
