import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { StudentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { WithdrawStudentDialog } from "../withdraw-student-dialog";

jest.mock("@/services", () => ({
  Services: {
    students: {
      withdrawStudent: jest.fn(),
    },
  },
}));

const mockWithdrawStudent = Services.students.withdrawStudent as jest.MockedFunction<
  typeof Services.students.withdrawStudent
>;

// Same shape as student-detail-sheet.test.tsx's own `studentDetail` fixture — every
// nullable field defaults to a real, non-null value so an override only ever changes
// the field a given test actually cares about.
function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "stu-1",
    admission_number: "2026-0050",
    first_name: "Aisha",
    last_name: "Khan",
    preferred_name: "Ash",
    date_of_birth: "2015-03-12",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-1",
    campus_name: "Main Campus",
    house_id: "house-1",
    house_name: "Blue House",
    status: "withdrawn",
    admission_date: "2026-01-10",
    blood_group: "O+",
    nationality: "Pakistani",
    religion: "Islam",
    previous_school: "City Grammar School",
    medical_notes: "No known allergies.",
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

/** Fills both required fields — the reason `Textarea` and the effective-date
 * `<input type="date">` — same reasoning as exit-staff-dialog.test.tsx's own `setDate`:
 * `userEvent.type` simulates per-segment keyboard entry jsdom's date input doesn't
 * actually implement, so the date is set directly via a change event instead. */
async function fillReason(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/reason/i), "Moved to another city");
  fireEvent.change(screen.getByLabelText(/effective date/i), {
    target: { value: "2026-09-15" },
  });
}

describe("WithdrawStudentDialog", () => {
  beforeEach(() => {
    mockWithdrawStudent.mockReset();
  });

  it("retries only the ids that failed on a partial bulk failure, showing why each one failed", async () => {
    const keysUsed: Record<string, string> = {};
    mockWithdrawStudent.mockImplementation((id, _input, key) => {
      keysUsed[id] = key;
      if (id === "s1") {
        return Promise.resolve(studentRecord({ id: "s1", status: "withdrawn" }));
      }
      return Promise.reject(
        new ApiError({
          code: "domain_rule_violation",
          status: 422,
          url: "",
          message: "Validation failed.",
          details: [{ field: "non_field", issue: "Student is suspended, not active." }],
        }),
      );
    });

    renderWithProviders(
      <WithdrawStudentDialog
        open
        onOpenChange={jest.fn()}
        studentIds={["s1", "s2"]}
        studentNames={["Ali", "Sara"]}
      />,
    );

    await fillReason(userEvent.setup());
    await userEvent.setup().click(screen.getByRole("button", { name: /withdraw 2/i }));

    expect(await screen.findByText("1 withdrawn, 1 failed")).toBeInTheDocument();
    expect(screen.getByText(/Sara.*Student is suspended, not active\./i)).toBeInTheDocument();

    // Retry: only the failed id ("s2") is resubmitted, with the SAME idempotency key it
    // used the first time — a lost response to a successful withdraw must not turn a
    // retry into a false failure.
    const s2Key = keysUsed.s2;
    mockWithdrawStudent.mockReset();
    mockWithdrawStudent.mockResolvedValueOnce(studentRecord({ id: "s2", status: "withdrawn" }));

    await userEvent.setup().click(screen.getByRole("button", { name: /retry failed/i }));

    expect(mockWithdrawStudent).toHaveBeenCalledTimes(1);
    expect(mockWithdrawStudent).toHaveBeenCalledWith("s2", expect.anything(), s2Key);
  });

  it("does not double-submit when the form is submitted again while the mutation is still pending", async () => {
    // Reproduces an Enter keypress in the Textarea/Input submitting the form directly —
    // that bypasses the confirm button's own `disabled`/`isLoading` state entirely, since
    // it never goes through a click. Before this fix, a second submit event in flight
    // issued a second, independent withdrawal request for the same student.
    let resolveWithdraw: (value: StudentRecord) => void = () => {};
    mockWithdrawStudent.mockReturnValue(
      new Promise((resolve) => {
        resolveWithdraw = resolve;
      }),
    );

    renderWithProviders(
      <WithdrawStudentDialog
        open
        onOpenChange={jest.fn()}
        studentIds={["s1"]}
        studentNames={["Ali"]}
      />,
    );

    await fillReason(userEvent.setup());
    // `AlertDialogContent` renders through a portal, outside the `container` div
    // `render()` returns — `screen` (which searches the whole document) finds the form
    // the portal actually mounted, `container.querySelector` does not.
    const form = screen.getByLabelText(/reason/i).closest("form");
    if (!form) throw new Error("form not found");

    fireEvent.submit(form);
    // `handleSubmit`'s `mutation.isPending` guard is checked synchronously, before
    // react-hook-form's own (always-async, since `zodResolver` returns a Promise)
    // validation has resolved — so it only protects a submit that arrives AFTER
    // `mutation.mutate()` has actually fired and flipped `isPending` true, not two
    // submits dispatched in the same tick. Wait for the first call to land for real
    // before firing the second, matching what an Enter keypress that lands after the
    // mutation is already in flight actually looks like.
    await waitFor(() => {
      expect(mockWithdrawStudent).toHaveBeenCalledTimes(1);
    });

    fireEvent.submit(form);
    // The guard short-circuits this one synchronously — give any stray async work a
    // tick to settle before asserting the call count stayed at 1.
    await waitFor(() => {
      expect(mockWithdrawStudent).toHaveBeenCalledTimes(1);
    });

    resolveWithdraw(studentRecord({ id: "s1", status: "withdrawn" }));
  });
});
