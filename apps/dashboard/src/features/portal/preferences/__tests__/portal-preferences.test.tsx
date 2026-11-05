import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
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

describe("PortalPreferences", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpdate.mockReset();
    mockFetch.mockResolvedValue([
      { event_category: "fees", channel: "email", is_enabled: true },
      { event_category: "fees", channel: "sms", is_enabled: false },
    ]);
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

  it("sends only the changed cell and shows the answered matrix", async () => {
    mockUpdate.mockResolvedValue([
      { event_category: "fees", channel: "email", is_enabled: false },
      { event_category: "fees", channel: "sms", is_enabled: false },
    ]);
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
