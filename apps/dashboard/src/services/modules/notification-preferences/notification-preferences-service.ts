import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type {
  NotificationPreferenceRow,
  NotificationPreferenceUpdate,
} from "./notification-preferences-type";

/** The caller's category x channel matrix (`/notification-preferences`). */

export async function fetchNotificationPreferences(): Promise<NotificationPreferenceRow[]> {
  const { data } = await apiClient.get<NotificationPreferenceRow[]>(
    endpoints.notificationPreferences.list,
  );
  return data;
}

/** Sends only the cells that changed; answers the whole matrix. */
export async function updateNotificationPreferences(
  rows: NotificationPreferenceUpdate[],
): Promise<NotificationPreferenceRow[]> {
  const { data } = await apiClient.patch<NotificationPreferenceRow[]>(
    endpoints.notificationPreferences.list,
    rows,
  );
  return data;
}
