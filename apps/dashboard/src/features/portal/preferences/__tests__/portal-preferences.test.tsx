import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { NOTIFICATION_CHANNELS } from "@/services/modules/notification-preferences/notification-preferences-constant";
import { NOTIFICATION_CATEGORIES } from "@/services/modules/notifications/notifications-constant";
import { renderWithProviders } from "@/test-utils";

import { PortalPreferences } from "../portal-preferences";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({
      notificationPreferences: ["fetchNotificationPreferences", "updateNotificationPreferences"],
    }),
);

const mockFetch = Services.notificationPreferences
  .fetchNotificationPreferences as jest.MockedFunction<
  typeof Services.notificationPreferences.fetchNotificationPreferences
>;
const mockUpdate = Services.notificationPreferences
  .updateNotificationPreferences as jest.MockedFunction<
  typeof Services.notificationPreferences.updateNotificationPreferences
>;

/** The full category x channel matrix, as `materialize_preference_matrix` answers (all enabled
 * unless overridden as `"category:channel"`). */
function fullMatrix(disabled: readonly string[] = []) {
  return NOTIFICATION_CATEGORIES.flatMap((event_category) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      event_category,
      channel,
      is_enabled: !disabled.includes(`${event_category}:${channel}`),
    })),
  );
}

describe("PortalPreferences", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockResolvedValue(fullMatrix(["fees:sms"]));
  });

  it("emergency preference cannot be turned off", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PortalPreferences />);
    const emergencyEmail = await screen.findByRole("checkbox", { name: "Emergency by Email" });

    expect(emergencyEmail).toBeDisabled();
    expect(emergencyEmail).toBeChecked();
    expect(screen.getByText(/always on/)).toBeInTheDocument();
    await user.click(emergencyEmail);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("in-app preference can be turned off for a non-emergency category", async () => {
    mockUpdate.mockResolvedValue([
      { event_category: "fees", channel: "in_app", is_enabled: false },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<PortalPreferences />);
    const feesInApp = await screen.findByRole("checkbox", { name: "Fees by In-app" });
    expect(feesInApp).toBeEnabled();
    await user.click(feesInApp);

    expect(mockUpdate).toHaveBeenCalledWith([
      { event_category: "fees", channel: "in_app", is_enabled: false },
    ]);
  });

  it("sends only the changed cell and shows the answered matrix", async () => {
    mockUpdate.mockResolvedValue(fullMatrix(["fees:email", "fees:sms"]));
    const user = userEvent.setup();

    renderWithProviders(<PortalPreferences />);
    const feesEmail = await screen.findByRole("checkbox", { name: "Fees by Email" });
    expect(feesEmail).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fees by SMS" })).not.toBeChecked();
    await user.click(feesEmail);

    expect(mockUpdate).toHaveBeenCalledWith([
      { event_category: "fees", channel: "email", is_enabled: false },
    ]);
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Fees by Email" })).not.toBeChecked();
    });
  });
});
