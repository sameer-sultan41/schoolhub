import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "./notification-preferences-service";

export const NotificationPreferencesService = {
  fetchNotificationPreferences,
  updateNotificationPreferences,
};
export type {
  NotificationChannel,
  NotificationPreferenceRow,
  NotificationPreferenceUpdate,
} from "./notification-preferences-type";
