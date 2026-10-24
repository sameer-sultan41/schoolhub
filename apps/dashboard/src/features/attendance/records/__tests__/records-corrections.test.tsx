import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";

import type { AttendanceCorrectionRecord } from "@/services";
import { attendancePage } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { amna, BILAL_RECORD_ID, bilal, sara } from "@/test-fixtures/attendance-records";

import {
  asUser,
  fetchPage,
  renderRecords,
  requestCorrection,
  stubRecordsServices,
} from "./records-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ recordsServicesMock: () => unknown }>("./records-services-mock")
    .recordsServicesMock(),
);

describe("RecordsTable corrections", () => {
  beforeEach(stubRecordsServices);

  it("offers Request correction on locked rows only, to a holder of the key", async () => {
    asUser("attendance.correction.create");
    fetchPage.mockResolvedValue(attendancePage([amna, bilal]));
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(
      screen.getByRole("button", { name: "Request a correction for Bilal Khan" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request a correction for Amna Raza" }),
    ).not.toBeInTheDocument();
  });

  it("offers no Request correction without the key, even on a locked row", async () => {
    await renderRecords();

    await screen.findByText("Bilal Khan");
    expect(screen.queryByRole("button", { name: /Request a correction/ })).not.toBeInTheDocument();
  });

  it("requests a correction of a locked row, holding Submit until a value differs", async () => {
    asUser("attendance.correction.create");
    requestCorrection.mockResolvedValue({
      id: "99999999-aaaa-4bbb-8ccc-000000000001",
    } as AttendanceCorrectionRecord);
    const user = await renderRecords();

    await user.click(
      await screen.findByRole("button", { name: "Request a correction for Bilal Khan" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Request a correction" });
    const submit = within(dialog).getByRole("button", { name: "Request correction" });
    expect(submit).toBeDisabled();

    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Present" }));
    expect(submit).toBeEnabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Gate log shows on time");
    await user.click(submit);

    await waitFor(() => {
      expect(requestCorrection).toHaveBeenCalledWith({
        studentAttendanceId: BILAL_RECORD_ID,
        newValues: { status: "present" },
        reason: "Gate log shows on time",
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Request a correction" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a server refusal under its field in the correction dialog", async () => {
    asUser("attendance.correction.create");
    const issue = "Not a known attendance status.";
    requestCorrection.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/attendance-corrections",
        details: [{ field: "new_values.status", issue }],
      }),
    );
    fetchPage.mockResolvedValue(attendancePage([amna, sara]));
    const user = await renderRecords();

    await user.click(
      await screen.findByRole("button", { name: "Request a correction for Sara Ali" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Request a correction" });
    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Present" }));
    await user.type(within(dialog).getByLabelText("Reason"), "Was present");
    await user.click(within(dialog).getByRole("button", { name: "Request correction" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(screen.getAllByText(issue)).toHaveLength(1);
  });
});
