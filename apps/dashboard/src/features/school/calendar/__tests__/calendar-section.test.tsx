import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type HolidayEntry } from "@/services";
import { CAMPUS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { CalendarSection } from "../calendar-section";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: { fetchHolidayCalendar: jest.fn(), updateHolidayCalendar: jest.fn() },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

const WEEKDAYS = [0, 1, 2, 3, 4];
const EID: HolidayEntry = {
  name: "Spring break",
  start_date: "2027-03-20",
  end_date: "2027-03-22",
  campus_id: null,
};
const SPORTS: HolidayEntry = {
  name: "Sports day",
  start_date: "2026-12-01",
  end_date: "2026-12-01",
  campus_id: CAMPUS_ID,
};

function renderSection() {
  renderWithProviders(<CalendarSection />);
  return userEvent.setup();
}

describe("calendar section", () => {
  beforeEach(() => {
    setUrl("/school/calendar");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(buildUser(["school.settings.view", "school.settings.update"]));
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
    so.fetchHolidayCalendar
      .mockReset()
      .mockResolvedValue({ working_days: WEEKDAYS, holidays: [EID, SPORTS] });
    so.updateHolidayCalendar
      .mockReset()
      .mockResolvedValue({ working_days: WEEKDAYS, holidays: [EID, SPORTS] });
  });

  it("lists the holidays by date, each with its days and campus", async () => {
    renderSection();

    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("Sports day");
    expect(await within(rows[1] as HTMLElement).findByText("Main Campus")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Spring break");
    expect(within(rows[2] as HTMLElement).getByText("All campuses")).toBeInTheDocument();
  });

  it("saves the working week alone, with Saturday added", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Saturday" }));
    await user.click(screen.getByRole("button", { name: "Save working week" }));

    await waitFor(() => {
      expect(so.updateHolidayCalendar).toHaveBeenCalledWith({ working_days: [0, 1, 2, 3, 4, 5] });
    });
  });

  it("holds Save until the school opens on at least one day", async () => {
    const user = renderSection();

    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await user.click(await screen.findByRole("button", { name: day }));
    }

    expect(screen.getByText("Pick at least one day the school is open.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save working week" })).toBeDisabled();
  });

  it("adds a one-day holiday, sending the whole list with it appended", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add holiday" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Founders Day");
    fireEvent.change(within(dialog).getByLabelText("First day"), {
      target: { value: "2026-12-25" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateHolidayCalendar).toHaveBeenCalledWith({
        holidays: [
          EID,
          SPORTS,
          {
            name: "Founders Day",
            start_date: "2026-12-25",
            end_date: "2026-12-25",
            campus_id: null,
          },
        ],
      });
    });
  });

  it("shows the server's refusal of this entry under its own input", async () => {
    const issue = "A holiday cannot end before it starts.";
    so.updateHolidayCalendar.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/holiday-calendar",
        details: [{ field: "holidays.1.end_date", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Sports day" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Last day")).toHaveAttribute("aria-invalid", "true");
  });

  it("refuses a last day before the first before sending", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Spring break" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Last day"), {
      target: { value: "2027-03-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("The last day can't be before the first."),
    ).toBeInTheDocument();
    expect(so.updateHolidayCalendar).not.toHaveBeenCalled();
  });

  it("removes a holiday by sending the list without it", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Remove Spring break" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(so.updateHolidayCalendar).toHaveBeenCalledWith({ holidays: [SPORTS] });
    });
  });

  it("is read only without the settings update key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["school.settings.view"]));

    renderSection();

    expect(await screen.findByText("Sports day")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add holiday" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save working week" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saturday" })).toBeDisabled();
  });

  it("says when the calendar can't be loaded", async () => {
    so.fetchHolidayCalendar.mockRejectedValue(new Error("offline"));

    renderSection();

    expect(await screen.findByText("The calendar couldn't be loaded.")).toBeInTheDocument();
  });
});
