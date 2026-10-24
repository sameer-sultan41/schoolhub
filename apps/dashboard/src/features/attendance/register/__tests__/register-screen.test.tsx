import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { todayIsoDate } from "@/lib/helpers";
import { Services, type MyRegister } from "@/services";
import { periodRecord } from "@/services/modules/periods/__tests__/periods-fixtures";
import {
  myRegister,
  PERIOD_ID,
  registerEntry,
  registerMetaWire,
  SECTION_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { toRegisterMeta } from "@/services/modules/student-attendance/student-attendance-helper";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { RegisterScreen } from "../register-screen";

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
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
    periods: { fetchCampusPeriods: jest.fn() },
    studentAttendance: {
      fetchMyRegisters: jest.fn(),
      fetchRegister: jest.fn(),
      bulkMark: jest.fn(),
    },
    attendanceCorrections: { requestCorrection: jest.fn() },
  },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const svc = Services;

const CLASS_ID = "66666666-aaaa-4bbb-8ccc-000000000001";
const CAMPUS_ID = "55555555-aaaa-4bbb-8ccc-000000000001";
const SECOND_PERIOD_ID = "11111111-aaaa-4bbb-8ccc-000000000004";

function myRegistersAre(registers: MyRegister[], mode: "daily" | "period" = "daily") {
  mocked(svc.studentAttendance.fetchMyRegisters).mockResolvedValue({
    registers,
    attendanceMode: mode,
  });
}

function periodRegister(periodId: string, periodName: string) {
  return myRegister({
    period_id: periodId,
    period_name: periodName,
    start_time: "08:00:00",
    end_time: "08:45:00",
  });
}

function renderScreen() {
  renderWithProviders(<RegisterScreen />);
  return userEvent.setup();
}

const urlParam = (key: string) => new URLSearchParams(window.location.search).get(key);

describe("RegisterScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/attendance/register");
    mocked(svc.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["attendance.student-attendance.mark"]),
    );
    mocked(svc.schoolOrganization.fetchClasses).mockResolvedValue([
      { id: CLASS_ID, name: "Grade 5" },
    ]);
    mocked(svc.schoolOrganization.fetchSections).mockResolvedValue([
      { id: SECTION_ID, name: "A", campus_id: CAMPUS_ID },
    ]);
    mocked(svc.periods.fetchCampusPeriods).mockResolvedValue([
      periodRecord({ id: PERIOD_ID, weekdays: null }),
      periodRecord({ id: "77777777-aaaa-4bbb-8ccc-000000000001", name: "Recess", is_break: true }),
    ]);
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue({
      entries: [registerEntry()],
      meta: toRegisterMeta(registerMetaWire()),
    });
  });

  it("lists today's registers and opens one, and goes back to the list", async () => {
    myRegistersAre([myRegister({ marked_count: 12 })]);
    const user = renderScreen();

    expect(await screen.findByText("12 of 30 marked")).toBeInTheDocument();
    expect(svc.studentAttendance.fetchMyRegisters).toHaveBeenCalledWith(todayIsoDate());

    await user.click(screen.getByRole("button", { name: "Open the register for Grade 5 · A" }));

    expect(
      await screen.findByRole("radiogroup", { name: "Status for Amna Raza" }),
    ).toBeInTheDocument();
    expect(urlParam("section")).toBe(SECTION_ID);
    expect(screen.getByRole("heading", { name: "Grade 5 · A" })).toBeInTheDocument();
    expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledWith({
      sectionId: SECTION_ID,
      date: todayIsoDate(),
      periodId: undefined,
    });

    await user.click(screen.getByRole("button", { name: "Back to my registers" }));
    expect(await screen.findByText("12 of 30 marked")).toBeInTheDocument();
    expect(urlParam("section")).toBeNull();
  });

  it("lists two periods of one section apart, and opens the period picked", async () => {
    myRegistersAre(
      [periodRegister(PERIOD_ID, "Period 1"), periodRegister(SECOND_PERIOD_ID, "Period 2")],
      "period",
    );
    const user = renderScreen();

    await screen.findByText("Grade 5 · A · Period 1");
    expect(screen.getByText("Grade 5 · A · Period 2")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Period" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open the register for Grade 5 · A · Period 2" }),
    );

    await waitFor(() => {
      expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledWith({
        sectionId: SECTION_ID,
        date: todayIsoDate(),
        periodId: SECOND_PERIOD_ID,
      });
    });
    expect(urlParam("period")).toBe(SECOND_PERIOD_ID);
  });

  it("offers no period picker in daily mode", async () => {
    myRegistersAre([myRegister()]);
    renderScreen();

    await screen.findByText("Grade 5 · A");
    expect(screen.getByRole("combobox", { name: "Class" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Section" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Period" })).not.toBeInTheDocument();
  });

  it("asks for a period before reading a register in period mode", async () => {
    setUrl(`/attendance/register?section=${SECTION_ID}`);
    myRegistersAre([], "period");
    renderScreen();

    expect(await screen.findByText("Pick a period")).toBeInTheDocument();
    expect(svc.studentAttendance.fetchRegister).not.toHaveBeenCalled();
  });

  it("follows the mode: a period left in the URL after a switch to daily is not sent", async () => {
    setUrl(`/attendance/register?section=${SECTION_ID}&period=${PERIOD_ID}`);
    myRegistersAre([], "daily");
    renderScreen();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledWith({
      sectionId: SECTION_ID,
      date: todayIsoDate(),
      periodId: undefined,
    });
  });

  it("re-reads the mode on Retry when a period is refused, so a stale mode recovers", async () => {
    const issue = "This school takes attendance once a day; leave the period out.";
    setUrl(`/attendance/register?section=${SECTION_ID}&period=${PERIOD_ID}`);
    // Cached as period mode; the school has since switched to daily.
    mocked(svc.studentAttendance.fetchMyRegisters)
      .mockResolvedValueOnce({ registers: [], attendanceMode: "period" })
      .mockResolvedValue({ registers: [], attendanceMode: "daily" });
    mocked(svc.studentAttendance.fetchRegister).mockRejectedValueOnce(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/student-attendance/register",
        details: [{ field: "period_id", issue }],
      }),
    );
    const user = renderScreen();

    expect(await screen.findByText(issue)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(svc.studentAttendance.fetchRegister).toHaveBeenLastCalledWith({
        sectionId: SECTION_ID,
        date: todayIsoDate(),
        periodId: undefined,
      });
    });
    expect(svc.studentAttendance.fetchMyRegisters).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("radiogroup", { name: "Status for Amna Raza" }),
    ).toBeInTheDocument();
  });

  it("picks a register by class, section and a lesson period of its campus", async () => {
    myRegistersAre([], "period");
    const user = renderScreen();

    await screen.findByText("No registers on this date");
    await user.click(screen.getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "Grade 5" }));
    await user.click(screen.getByRole("combobox", { name: "Section" }));
    await user.click(await screen.findByRole("option", { name: "A" }));
    await user.click(screen.getByRole("combobox", { name: "Period" }));

    expect(await screen.findByRole("option", { name: "Period 1 (08:00–08:45)" })).toBeVisible();
    // A break is not a lesson: no register is taken for it.
    expect(screen.queryByRole("option", { name: /Recess/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Period 1 (08:00–08:45)" }));

    await waitFor(() => {
      expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledWith({
        sectionId: SECTION_ID,
        date: todayIsoDate(),
        periodId: PERIOD_ID,
      });
    });
    expect(svc.periods.fetchCampusPeriods).toHaveBeenCalledWith(CAMPUS_ID);
  });

  it("reads another date's registers when the date changes", async () => {
    myRegistersAre([myRegister()]);
    renderScreen();

    await screen.findByText("Grade 5 · A");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-20" } });

    await waitFor(() => {
      expect(svc.studentAttendance.fetchMyRegisters).toHaveBeenCalledWith("2026-10-20");
    });
    expect(urlParam("date")).toBe("2026-10-20");
  });

  it("drops the period, and keeps the section, when the date changes in period mode", async () => {
    setUrl(`/attendance/register?section=${SECTION_ID}&period=${PERIOD_ID}`);
    myRegistersAre([], "period");
    renderScreen();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-20" } });

    expect(await screen.findByText("Pick a period")).toBeInTheDocument();
    expect(urlParam("date")).toBe("2026-10-20");
    expect(urlParam("period")).toBeNull();
    expect(urlParam("section")).toBe(SECTION_ID);
  });
});
