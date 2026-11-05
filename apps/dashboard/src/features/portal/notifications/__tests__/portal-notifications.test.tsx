import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { cursorPage } from "@/test-fixtures/communication";
import { notificationRecord } from "@/test-fixtures/portal";
import { renderWithProviders } from "@/test-utils";

import { PortalNotifications } from "../portal-notifications";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({
      notifications: ["listNotifications", "markNotificationRead", "markAllNotificationsRead"],
    }),
);

const mockList = Services.notifications.listNotifications as jest.MockedFunction<
  typeof Services.notifications.listNotifications
>;
const mockMarkRead = Services.notifications.markNotificationRead as jest.MockedFunction<
  typeof Services.notifications.markNotificationRead
>;
const mockMarkAll = Services.notifications.markAllNotificationsRead as jest.MockedFunction<
  typeof Services.notifications.markAllNotificationsRead
>;

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

describe("PortalNotifications", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockMarkRead.mockReset();
    mockMarkAll.mockReset();
  });

  it("opening a notification marks it read once, and retries after an error", async () => {
    mockList.mockResolvedValue(cursorPage([notificationRecord(FIRST)]));
    mockMarkRead
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ read_at: "2026-11-04T10:00:00Z" });
    const user = userEvent.setup();

    renderWithProviders(<PortalNotifications />);
    const row = await screen.findByRole("button", { name: /Invoice issued/ });

    await user.click(row);
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/couldn't mark that notification read/)).toBeInTheDocument();

    // Close, then open again: the failed call released the id, so it is tried again.
    await user.click(row);
    await user.click(row);
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledTimes(2);
    });
    expect(mockMarkRead).toHaveBeenLastCalledWith(FIRST);

    // It worked, so opening it yet again does not repeat the call.
    await user.click(row);
    await user.click(row);
    expect(mockMarkRead).toHaveBeenCalledTimes(2);
  });

  it("keeps an opened notification visible under the unread filter after it is marked read", async () => {
    let marked = false;
    // The server drops a read row from the unread filter, so a list refetch would hide it.
    mockList.mockImplementation((query) =>
      Promise.resolve(
        cursorPage(query?.read === false && marked ? [] : [notificationRecord(FIRST)]),
      ),
    );
    mockMarkRead.mockImplementation(() => {
      marked = true;
      return Promise.resolve({ read_at: "2026-11-04T10:00:00Z" });
    });
    const user = userEvent.setup();

    renderWithProviders(<PortalNotifications />);
    await screen.findByRole("button", { name: /Invoice issued/ });
    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "Unread" }));
    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ read: false }));
    });

    const row = await screen.findByRole("button", { name: /Invoice issued/ });
    await user.click(row);

    // The cached row takes the answered read_at: its Unread flag goes, and the row stays.
    await waitFor(() => {
      expect(within(row).queryByText("Unread")).not.toBeInTheDocument();
    });
    expect(mockMarkRead).toHaveBeenCalledWith(FIRST);
    expect(screen.getByText(/Invoice INV-0001/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invoice issued/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows a category and priority the dashboard does not know yet as humanised text", async () => {
    // A row the server sends with values added after this build: Object.assign keeps the
    // record's type while the runtime values are new.
    const row = Object.assign(notificationRecord(FIRST), {
      category: "lost_and_found",
      priority: "critical",
    });
    mockList.mockResolvedValue(cursorPage([row]));

    renderWithProviders(<PortalNotifications />);

    expect(await screen.findByText("Lost and found")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText(/categories\./)).not.toBeInTheDocument();
  });

  it("does not mark an already-read notification", async () => {
    mockList.mockResolvedValue(
      cursorPage([notificationRecord(FIRST, { read_at: "2026-11-03T10:00:00Z" })]),
    );
    const user = userEvent.setup();

    renderWithProviders(<PortalNotifications />);
    await user.click(await screen.findByRole("button", { name: /Invoice issued/ }));

    expect(screen.getByText(/Invoice INV-0001/)).toBeInTheDocument();
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it("mark all read sends the newest on-screen timestamp as before", async () => {
    mockList.mockResolvedValue(
      cursorPage([
        notificationRecord(FIRST, { created_at: "2026-11-03T09:00:00Z" }),
        notificationRecord(SECOND, { created_at: "2026-11-04T10:30:00Z", title: "Newer" }),
      ]),
    );
    mockMarkAll.mockResolvedValue({ marked: 2 });
    const user = userEvent.setup();

    renderWithProviders(<PortalNotifications />);
    await screen.findByRole("button", { name: /Newer/ });
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(mockMarkAll).toHaveBeenCalledWith("2026-11-04T10:30:00Z");
    });
  });

  it("disables Mark all read when nothing on screen is unread", async () => {
    mockList.mockResolvedValue(
      cursorPage([notificationRecord(FIRST, { read_at: "2026-11-04T10:00:00Z" })]),
    );

    renderWithProviders(<PortalNotifications />);

    await screen.findByRole("button", { name: /Invoice issued/ });
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });

  it("filters by read state", async () => {
    mockList.mockResolvedValue(cursorPage([notificationRecord(FIRST)]));
    const user = userEvent.setup();

    renderWithProviders(<PortalNotifications />);
    await screen.findByRole("button", { name: /Invoice issued/ });
    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "Unread" }));

    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ read: false }));
    });
  });
});
