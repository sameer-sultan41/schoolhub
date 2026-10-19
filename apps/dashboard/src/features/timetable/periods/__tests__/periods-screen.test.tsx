import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  CAMPUS_PERIOD,
  periodPage,
  periodRecord,
} from "@/services/modules/periods/__tests__/periods-fixtures";
import { CAMPUS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { PeriodsTable } from "../periods-table";
import { PeriodsToolbar } from "../periods-toolbar";

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
    periods: {
      fetchPeriodPage: jest.fn(),
      createPeriod: jest.fn(),
      updatePeriod: jest.fn(),
      deletePeriod: jest.fn(),
    },
    dashboard: { fetchCampuses: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchPeriodPage = Services.periods.fetchPeriodPage as jest.MockedFunction<
  typeof Services.periods.fetchPeriodPage
>;
const mockCreatePeriod = Services.periods.createPeriod as jest.MockedFunction<
  typeof Services.periods.createPeriod
>;
const mockUpdatePeriod = Services.periods.updatePeriod as jest.MockedFunction<
  typeof Services.periods.updatePeriod
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["timetable.timetable.view", "timetable.period.update", ...permissions]);
}

const FULL_ACCESS = userWith("timetable.period.create", "timetable.period.delete");

/** jsdom drops a partly typed time (each keystroke is an invalid value), so set it whole. */
function setTime(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function renderScreen() {
  renderWithProviders(
    <>
      <PeriodsToolbar />
      <PeriodsTable />
    </>,
  );
  return userEvent.setup();
}

describe("periods screen", () => {
  beforeEach(() => {
    setUrl("/timetable/periods");
    mockFetchCurrentUser.mockReset().mockResolvedValue(FULL_ACCESS);
    mockFetchPeriodPage.mockReset().mockResolvedValue(periodPage([periodRecord()]));
    mockCreatePeriod.mockReset();
    mockUpdatePeriod.mockReset();
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists each period with its time, kind, days and campus", async () => {
    mockFetchPeriodPage.mockResolvedValue(
      periodPage([
        periodRecord(),
        periodRecord({
          id: "1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b",
          name: "Recess",
          sequence: 2,
          start_time: "10:00:00",
          end_time: "10:20:00",
          is_break: true,
          weekdays: [0, 2],
          ...CAMPUS_PERIOD,
        }),
      ]),
    );

    renderScreen();

    expect(await screen.findByText("Recess")).toBeInTheDocument();
    expect(screen.getByText("08:00–08:45")).toBeInTheDocument();
    expect(screen.getByText("Break")).toBeInTheDocument();
    expect(screen.getByText("Mon, Wed")).toBeInTheDocument();
    expect(screen.getByText("Every working day")).toBeInTheDocument();
    expect(screen.getByText("All campuses")).toBeInTheDocument();
    expect(screen.getByText("Main Campus")).toBeInTheDocument();
  });

  it("requests the bell schedule in sequence order", async () => {
    renderScreen();

    await waitFor(() => {
      expect(mockFetchPeriodPage).toHaveBeenCalledWith(
        expect.objectContaining({
          ordering: "sequence",
          forCampusId: undefined,
          isBreak: undefined,
        }),
      );
    });
  });

  it("reads its campus and kind filters from the URL, and writes a new pick back", async () => {
    setUrl(`/timetable/periods?campus=${CAMPUS_ID}&kind=break`);
    const user = renderScreen();

    await waitFor(() => {
      expect(mockFetchPeriodPage).toHaveBeenCalledWith(
        expect.objectContaining({ forCampusId: CAMPUS_ID, isBreak: true }),
      );
    });

    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    await user.click(await screen.findByRole("option", { name: "Teaching" }));

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("kind")).toBe("teaching");
    });
    expect(mockFetchPeriodPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ forCampusId: CAMPUS_ID, isBreak: false }),
    );
  });

  it("offers no row actions or Add button to a viewer who can only update elsewhere", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["timetable.timetable.view"]));

    renderScreen();

    expect(await screen.findByText("Period 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Period 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add period" })).not.toBeInTheDocument();
  });

  it("creates a period on the picked days and refreshes the list", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    mockCreatePeriod.mockResolvedValue(periodRecord());
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Add period" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Period 9");
    setTime(within(dialog).getByLabelText("Starts"), "14:00");
    setTime(within(dialog).getByLabelText("Ends"), "14:45");
    await user.click(within(dialog).getByRole("button", { name: "Friday" }));
    await user.click(within(dialog).getByRole("button", { name: "Monday" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockCreatePeriod).toHaveBeenCalledWith({
        campusId: null,
        name: "Period 9",
        sequence: 1,
        startTime: "14:00",
        endTime: "14:45",
        isBreak: false,
        weekdays: [0, 4],
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["periods"] });
  });

  it("shows the server's overlap error under the start time and keeps the dialog open", async () => {
    mockCreatePeriod.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Overlaps Period 1.",
        status: 422,
        url: "/periods",
        details: [{ field: "start_time", issue: "Overlaps Period 1." }],
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Add period" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Clash");
    setTime(within(dialog).getByLabelText("Starts"), "08:10");
    setTime(within(dialog).getByLabelText("Ends"), "08:40");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Overlaps Period 1.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Starts")).toHaveAttribute("aria-invalid", "true");
  });

  it("edits a period, clearing its days back to the working days", async () => {
    mockFetchPeriodPage.mockResolvedValue(periodPage([periodRecord({ weekdays: [1] })]));
    mockUpdatePeriod.mockResolvedValue(periodRecord());
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Period 1" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Tuesday" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdatePeriod).toHaveBeenCalledWith(
        periodRecord().id,
        expect.objectContaining({ weekdays: null, startTime: "08:00", endTime: "08:45" }),
      );
    });
  });
});
