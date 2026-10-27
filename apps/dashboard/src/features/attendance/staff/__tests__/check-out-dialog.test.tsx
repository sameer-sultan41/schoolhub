import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import {
  CHECK_OUT_NOT_AFTER,
  domainRefusal,
  LOCKED_CHECK_OUT,
  lockedConflict,
  OTHER_STAFF_ROW_ID,
} from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";

import {
  checkOutStaff,
  fetchRegister,
  nadia,
  omar,
  omarRecord,
  renderStaff,
  sara,
  staffRow,
  stubStaffServices,
} from "./staff-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ staffServicesMock: () => unknown }>("./staff-services-mock")
    .staffServicesMock(),
);

const CHECK_OUT_URL = `/staff-attendance/${OTHER_STAFF_ROW_ID}:check-out`;

/** Opens Check out on Omar's row (present, in at 08:00, not yet out). */
async function openCheckOut() {
  const rendered = await renderStaff();
  await rendered.user.click(await screen.findByRole("button", { name: "Check out Omar Farooq" }));
  const dialog = await screen.findByRole("dialog", { name: "Check out" });
  return { ...rendered, dialog };
}

const submit = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Record check-out" });
const timeInput = (dialog: HTMLElement) => within(dialog).getByLabelText("Check-out time");

describe("CheckOutDialog", () => {
  beforeEach(() => {
    stubStaffServices();
  });

  it("records the departure and shows it on the row", async () => {
    checkOutStaff.mockResolvedValue({
      ...omarRecord,
      check_out_time: "16:30:00",
      early_departure_minutes: 0,
      updated_at: "2026-10-23T16:30:00Z",
    });
    const { user, dialog } = await openCheckOut();
    expect(
      within(dialog).getByText("Omar Farooq checked in at 08:00 on October 23rd, 2026."),
    ).toBeInTheDocument();

    fireEvent.change(timeInput(dialog), { target: { value: "16:30" } });
    await user.click(submit(dialog));

    await waitFor(() => {
      expect(checkOutStaff).toHaveBeenCalledWith(OTHER_STAFF_ROW_ID, "16:30");
    });
    expect(toast.success).toHaveBeenCalledWith("Check-out recorded for Omar Farooq.");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Check out" })).not.toBeInTheDocument();
    });
    expect(staffRow("Omar Farooq").getByText("Out at 16:30")).toBeInTheDocument();
    // Out already: nothing left to check out.
    expect(screen.queryByRole("button", { name: "Check out Omar Farooq" })).not.toBeInTheDocument();
    expect(fetchRegister).toHaveBeenCalledTimes(1);
  });

  it("keeps remarks typed on the row before Check out, still unsaved", async () => {
    checkOutStaff.mockResolvedValue({
      ...omarRecord,
      check_out_time: "16:30:00",
      updated_at: "2026-10-23T16:30:00Z",
    });
    const { user } = await renderStaff();
    await user.type(await screen.findByLabelText("Remarks for Omar Farooq"), "Left for a meeting");

    await user.click(screen.getByRole("button", { name: "Check out Omar Farooq" }));
    const dialog = await screen.findByRole("dialog", { name: "Check out" });
    fireEvent.change(timeInput(dialog), { target: { value: "16:30" } });
    await user.click(submit(dialog));

    await waitFor(() => {
      expect(staffRow("Omar Farooq").getByText("Out at 16:30")).toBeInTheDocument();
    });
    // The check-out changed the record; the row's unsaved edit is still there to save.
    expect(screen.getByLabelText("Remarks for Omar Farooq")).toHaveValue("Left for a meeting");
    expect(screen.getByRole("button", { name: "Save attendance for Omar Farooq" })).toBeEnabled();
  });

  it("needs a time later than the check-in before it asks the server", async () => {
    const { user, dialog } = await openCheckOut();

    await user.click(submit(dialog));
    expect(await within(dialog).findByText("Enter the check-out time.")).toBeInTheDocument();

    fireEvent.change(timeInput(dialog), { target: { value: "08:00" } });
    await user.click(submit(dialog));
    expect(
      await within(dialog).findByText("Check-out must be later than check-in."),
    ).toBeInTheDocument();
    expect(checkOutStaff).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of the time under the field", async () => {
    // The check-in moved since the register loaded (an approved correction, say).
    checkOutStaff.mockRejectedValue(
      domainRefusal("check_out_time", CHECK_OUT_NOT_AFTER, CHECK_OUT_URL),
    );
    const { user, dialog } = await openCheckOut();

    fireEvent.change(timeInput(dialog), { target: { value: "09:00" } });
    await user.click(submit(dialog));

    expect(await within(dialog).findByText(CHECK_OUT_NOT_AFTER)).toBeInTheDocument();
    expect(timeInput(dialog)).toHaveAttribute("aria-invalid", "true");
  });

  it("says so and reloads the register when the row locked since it loaded", async () => {
    checkOutStaff.mockRejectedValue(lockedConflict(LOCKED_CHECK_OUT, CHECK_OUT_URL));
    const { user, dialog } = await openCheckOut();
    const lockedOmar = { ...omar, record: { ...omarRecord, is_locked: true } };
    fetchRegister.mockResolvedValue([nadia, lockedOmar, sara]);

    fireEvent.change(timeInput(dialog), { target: { value: "16:30" } });
    await user.click(submit(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(LOCKED_CHECK_OUT);
    await waitFor(() => {
      expect(fetchRegister).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(staffRow("Omar Farooq").getByText("Locked")).toBeInTheDocument();
    });
  });
});
