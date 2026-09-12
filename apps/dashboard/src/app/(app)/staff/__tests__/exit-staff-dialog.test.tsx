import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { StaffDirectoryRecord } from "@/services/modules/dashboard/dashboard-service";
import { renderWithProviders } from "@/test-utils";

import { ExitStaffDialog } from "../exit-staff-dialog";

jest.mock("@/services", () => ({
  Services: {
    dashboard: {
      exitStaff: jest.fn(),
    },
  },
}));

// Only what the component actually calls — matching staff-form-dialog.test.tsx's own
// reasoning for mocking only what's used, not the whole sonner surface.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockExitStaff = Services.dashboard.exitStaff as jest.MockedFunction<
  typeof Services.dashboard.exitStaff
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;
const mockToastWarning = toast.warning as jest.MockedFunction<typeof toast.warning>;

function makeRecord(overrides: Partial<StaffDirectoryRecord> = {}): StaffDirectoryRecord {
  return {
    id: "st-1",
    first_name: "Ayesha",
    last_name: "Khan",
    designation_name: null,
    department_name: null,
    campus_name: "Main Campus",
    staff_type: "teaching",
    employment_status: "exited",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/** `<input type="date">` — same reasoning as staff-form-dialog.test.tsx's own `setDate`:
 * `userEvent.type` simulates per-segment keyboard entry jsdom's date input doesn't
 * actually implement, so the value is set directly via a change event instead. */
function setDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, reason: string) {
  setDate(screen.getByLabelText(/^exit date$/i), "2026-09-10");
  await user.type(screen.getByLabelText(/^exit reason$/i), reason);
}

describe("ExitStaffDialog", () => {
  beforeEach(() => {
    mockExitStaff.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockToastWarning.mockReset();
  });

  it("single id: calls exitStaff once with the right id and payload, toasts success, and closes", async () => {
    mockExitStaff.mockResolvedValue(makeRecord());
    const onOpenChange = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ExitStaffDialog open staffIds={["st-1"]} onOpenChange={onOpenChange} />,
    );

    await fillRequiredFields(user, "Resigned voluntarily");
    await user.click(screen.getByRole("button", { name: /^exit staff member$/i }));

    await waitFor(() => {
      expect(mockExitStaff).toHaveBeenCalledTimes(1);
    });
    // exit_type left unset, so the payload omits `exitType` entirely rather than sending
    // a client-side "resigned" default the server itself already applies.
    expect(mockExitStaff).toHaveBeenCalledWith("st-1", {
      exitDate: "2026-09-10",
      exitReason: "Resigned voluntarily",
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Staff member exited");
  });

  it("bulk, all succeed: calls exitStaff once per id and toasts a count-aware success message", async () => {
    mockExitStaff.mockResolvedValue(makeRecord());
    const onOpenChange = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ExitStaffDialog open staffIds={["st-1", "st-2"]} onOpenChange={onOpenChange} />,
    );

    await fillRequiredFields(user, "End of contract");
    await user.click(screen.getByRole("button", { name: /^exit staff members$/i }));

    await waitFor(() => {
      expect(mockExitStaff).toHaveBeenCalledTimes(2);
    });
    expect(mockExitStaff).toHaveBeenNthCalledWith(1, "st-1", {
      exitDate: "2026-09-10",
      exitReason: "End of contract",
    });
    expect(mockExitStaff).toHaveBeenNthCalledWith(2, "st-2", {
      exitDate: "2026-09-10",
      exitReason: "End of contract",
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("2 staff members exited");
  });

  it("bulk, partial failure: does not report full success, stays open, and surfaces the real backend message", async () => {
    mockExitStaff.mockImplementation((id: string) =>
      id === "st-1"
        ? Promise.resolve(makeRecord({ id: "st-1" }))
        : Promise.reject(
            new ApiError({
              code: "domain_rule_violation",
              message: "This staff member has already exited",
              status: 409,
              url: "/staff/st-2:exit",
            }),
          ),
    );
    const onOpenChange = jest.fn();
    const user = userEvent.setup();

    // `staffNames` deliberately omitted here — exercises the fallback where the failure
    // list shows the raw id instead of a name.
    renderWithProviders(
      <ExitStaffDialog open staffIds={["st-1", "st-2"]} onOpenChange={onOpenChange} />,
    );

    await fillRequiredFields(user, "Bulk exit attempt");
    await user.click(screen.getByRole("button", { name: /^exit staff members$/i }));

    await waitFor(() => {
      expect(mockExitStaff).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText(/This staff member has already exited/i)).toBeInTheDocument();
    });
    // The raw id shows up in the failure list since no `staffNames` was supplied.
    expect(screen.getByText(/st-2/)).toBeInTheDocument();
    expect(mockToastWarning).toHaveBeenCalledWith("1 of 2 exited; 1 failed");
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("rejects an exit_reason over 300 characters client-side, with no exitStaff call made", async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ExitStaffDialog open staffIds={["st-1"]} onOpenChange={onOpenChange} />,
    );

    setDate(screen.getByLabelText(/^exit date$/i), "2026-09-10");
    const reasonInput = screen.getByLabelText(/^exit reason$/i);
    // Typed via fireEvent, not user.type, purely for speed — 301 characters one keystroke
    // at a time is unnecessarily slow and adds nothing user.type's own event simulation
    // would catch here (there is no per-keystroke masking/formatting on this field, unlike
    // the date input above).
    fireEvent.change(reasonInput, { target: { value: "a".repeat(301) } });
    await user.click(screen.getByRole("button", { name: /^exit staff member$/i }));

    await waitFor(() => {
      expect(reasonInput).toHaveAttribute("aria-invalid", "true");
    });
    expect(mockExitStaff).not.toHaveBeenCalled();
  });

  it("empty staffIds: never reports success and never calls exitStaff", async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ExitStaffDialog open staffIds={[]} onOpenChange={onOpenChange} />,
    );

    const submitButton = screen.getByRole("button", { name: /^exit staff member$/i });
    await fillRequiredFields(user, "Nothing to actually exit");
    await user.click(submitButton);

    // Wait for the mutation to actually settle (its pending state round-trips through
    // `disabled` on this same button) before asserting the negatives below — otherwise
    // they could trivially pass just because nothing has run yet.
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
    expect(mockExitStaff).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
