import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "./notification-preferences-service";

export const NotificationPreferencesService = {
  fetchNotificationPreferences,
  updateNotificationPreferences,
};
export type {
  NotificationPreferenceRow,
  NotificationPreferenceUpdate,
} from "./notification-preferences-type";
