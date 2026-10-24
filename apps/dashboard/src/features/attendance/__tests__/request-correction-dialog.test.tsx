import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import {
  Services,
  type AttendanceCorrectionRecord,
  type StudentAttendanceRecord,
} from "@/services";
import { attendanceRecord } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { renderWithProviders } from "@/test-utils";

import { RequestCorrectionDialog } from "../request-correction-dialog";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { attendanceCorrections: { requestCorrection: jest.fn() } },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const requestCorrection = mocked(Services.attendanceCorrections.requestCorrection);

/** A locked late arrival at 08:20, as the register and Records show it. */
const LOCKED_LATE = attendanceRecord({
  status: "late",
  check_in_time: "08:20:00",
  late_minutes: 20,
  is_locked: true,
});

function correction(
  overrides: Partial<AttendanceCorrectionRecord> = {},
): AttendanceCorrectionRecord {
  return {
    id: "99999999-aaaa-4bbb-8ccc-000000000001",
    subject_type: "student",
    student_attendance_id: LOCKED_LATE.id,
    requested_by: "44444444-aaaa-4bbb-8ccc-000000000001",
    old_values: { check_in_time: "08:20:00" },
    new_values: { check_in_time: "08:10:00" },
    reason: "Gate log shows 08:10",
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: "2026-10-23T09:00:00Z",
    updated_at: "2026-10-23T09:00:00Z",
    ...overrides,
  };
}

function renderDialog(record: StudentAttendanceRecord = LOCKED_LATE) {
  const onOpenChange = jest.fn();
  const onRequested = jest.fn();
  renderWithProviders(
    <RequestCorrectionDialog
      open
      onOpenChange={onOpenChange}
      target={{ kind: "student", record }}
      onRequested={onRequested}
    />,
  );
  return { user: userEvent.setup(), onOpenChange, onRequested };
}

const dialog = () => screen.getByRole("dialog", { name: "Request a correction" });
const submit = () => within(dialog()).getByRole("button", { name: "Request correction" });

describe("RequestCorrectionDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts from the record and holds Submit until a value differs", async () => {
    requestCorrection.mockResolvedValue(correction());
    const { user, onOpenChange, onRequested } = renderDialog();

    expect(screen.getByLabelText("Check-in time")).toHaveValue("08:20");
    expect(submit()).toBeDisabled();
    expect(
      screen.getByText("Change at least one value to request a correction."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Check-in time"), { target: { value: "08:10" } });
    expect(submit()).toBeEnabled();
    // Back to the record's own value: nothing to ask for again.
    fireEvent.change(screen.getByLabelText("Check-in time"), { target: { value: "08:20" } });
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Check-in time"), { target: { value: "08:10" } });
    await user.type(screen.getByLabelText("Reason"), "  Gate log shows 08:10 ");
    await user.click(submit());

    await waitFor(() => {
      expect(requestCorrection).toHaveBeenCalledWith({
        studentAttendanceId: LOCKED_LATE.id,
        // Only what changed is proposed.
        newValues: { check_in_time: "08:10" },
        reason: "Gate log shows 08:10",
      });
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Correction requested. It takes effect once it is approved.",
    );
    expect(onRequested).toHaveBeenCalledWith(correction());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers every register status but on_leave", async () => {
    const { user } = renderDialog();

    await user.click(within(dialog()).getByRole("combobox", { name: "Status" }));

    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Present", "Absent", "Late", "Half day", "Excused"]);
  });

  it("needs a reason", async () => {
    const { user } = renderDialog();

    await user.click(within(dialog()).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Present" }));
    await user.click(submit());

    expect(await screen.findByText("Give a reason for the correction.")).toBeInTheDocument();
    expect(requestCorrection).not.toHaveBeenCalled();
  });

  it("clears a time to null and sends a new status", async () => {
    requestCorrection.mockResolvedValue(correction());
    const { user } = renderDialog();

    await user.click(within(dialog()).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Present" }));
    fireEvent.change(screen.getByLabelText("Check-in time"), { target: { value: "" } });
    await user.type(screen.getByLabelText("Reason"), "Arrived on time");
    await user.click(submit());

    await waitFor(() => {
      expect(requestCorrection).toHaveBeenCalledWith({
        studentAttendanceId: LOCKED_LATE.id,
        newValues: { status: "present", check_in_time: null },
        reason: "Arrived on time",
      });
    });
  });

  it("shows a server refusal under the field it names", async () => {
    // `validate_new_values` names `new_values.status` for a status the server no longer knows.
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
    const { user } = renderDialog();

    await user.click(within(dialog()).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Absent" }));
    await user.type(screen.getByLabelText("Reason"), "Was absent");
    await user.click(submit());

    expect(await screen.findByText(issue)).toBeInTheDocument();
    // Under the status only, not repeated as the dialog's own message.
    expect(screen.getAllByText(issue)).toHaveLength(1);
  });

  it("shows a refusal of the record itself as the dialog's message", async () => {
    // The lock window was raised since the row was read, so it is editable again.
    const issue = "This record is still within the marking window; edit the register instead.";
    requestCorrection.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/attendance-corrections",
        details: [{ field: "student_attendance_id", issue }],
      }),
    );
    const { user } = renderDialog();

    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "Bus late" } });
    await user.type(screen.getByLabelText("Reason"), "Context");
    await user.click(submit());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(issue);
  });
});
