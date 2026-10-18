import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  ALLOCATION_ID,
  allocationRecord,
  overNormWarning,
  savedAllocation,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { renderWithProviders } from "@/test-utils";

import { EditAllocationDialog } from "../edit-allocation-dialog";

// Saving surfaces as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// Only the update: an edit shows the identity read-only, so it fetches no lists (a call to any
// other Service would crash the test with "not a function").
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { teacherAllocations: { updateAllocation: jest.fn() } },
}));

const mockUpdateAllocation = Services.teacherAllocations.updateAllocation as jest.MockedFunction<
  typeof Services.teacherAllocations.updateAllocation
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastWarning = toast.warning as jest.MockedFunction<typeof toast.warning>;

type User = ReturnType<typeof userEvent.setup>;

function renderEdit(record = allocationRecord()) {
  const onOpenChange = jest.fn();
  renderWithProviders(<EditAllocationDialog open onOpenChange={onOpenChange} record={record} />);
  return { onOpenChange, user: userEvent.setup() };
}

function save(user: User) {
  return user.click(screen.getByRole("button", { name: "Save" }));
}

/** The smallest edit there is: an override typed into a row that has none. */
function typePeriods(user: User, periods: string) {
  return user.type(screen.getByLabelText("Weekly periods"), periods);
}

function apiError(status: number, code: string, field: string, issue: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: `/teacher-subject-allocations/${ALLOCATION_ID}`,
    details: [{ field, issue }],
  });
}

describe("EditAllocationDialog", () => {
  beforeEach(() => {
    mockUpdateAllocation.mockReset().mockResolvedValue(savedAllocation());
    mockToastSuccess.mockReset();
    mockToastWarning.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what it shows", () => {
    it("shows the section, subject and teacher read-only, with no pickers", () => {
      renderEdit();

      expect(screen.getByRole("dialog", { name: "Edit allocation" })).toBeInTheDocument();
      expect(screen.getByText("Grade 1 · A")).toBeInTheDocument();
      expect(screen.getByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("starts from the allocation's own role, override and start date", () => {
      renderEdit(
        allocationRecord({ is_primary: false, weekly_periods: 5, effective_from: "2026-09-01" }),
      );

      expect(screen.getByRole("switch", { name: "Primary teacher" })).not.toBeChecked();
      expect(screen.getByLabelText("Weekly periods")).toHaveValue(5);
      expect(screen.getByLabelText("Effective from")).toHaveValue("2026-09-01");
    });

    it("starts with a blank override and start date for an allocation with neither", () => {
      renderEdit();

      expect(screen.getByRole("switch", { name: "Primary teacher" })).toBeChecked();
      expect(screen.getByLabelText("Weekly periods")).toHaveValue(null);
      expect(screen.getByLabelText("Effective from")).toHaveValue("");
    });
  });

  describe("saving", () => {
    it("sends all three editable fields when all changed, never the end date", async () => {
      const { onOpenChange, user } = renderEdit();

      await user.click(screen.getByRole("switch", { name: "Primary teacher" }));
      await typePeriods(user, "7");
      fireEvent.change(screen.getByLabelText("Effective from"), {
        target: { value: "2026-09-15" },
      });
      await save(user);

      await waitFor(() => {
        expect(mockUpdateAllocation).toHaveBeenCalledWith(ALLOCATION_ID, {
          isPrimary: false,
          weeklyPeriods: 7,
          effectiveFrom: "2026-09-15",
        });
      });
      const input = mockUpdateAllocation.mock.calls[0]?.[1];
      expect(Object.keys(input ?? {}).sort()).toEqual([
        "effectiveFrom",
        "isPrimary",
        "weeklyPeriods",
      ]);
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Allocation saved.");
      expect(mockToastWarning).not.toHaveBeenCalled();
    });

    it("sends only the field that changed", async () => {
      const { user } = renderEdit(
        allocationRecord({ weekly_periods: 5, effective_from: "2026-09-01" }),
      );

      await user.click(screen.getByRole("switch", { name: "Primary teacher" }));
      await save(user);

      await waitFor(() => {
        expect(mockUpdateAllocation).toHaveBeenCalledTimes(1);
      });
      const input = mockUpdateAllocation.mock.calls[0]?.[1];
      expect(input).toEqual({ isPrimary: false });
      expect(input).not.toHaveProperty("weeklyPeriods");
      expect(input).not.toHaveProperty("effectiveFrom");
    });

    it("leaves the start date out when only the periods change on a displaced row", async () => {
      // Displaced from a future start, it carries a future end date, and the server refuses a
      // PATCH that resends the start date: an unrelated edit must not.
      const displaced = allocationRecord({
        weekly_periods: 5,
        effective_from: "2999-01-01",
        effective_to: "2999-06-01",
      });
      const { user } = renderEdit(displaced);

      await user.clear(screen.getByLabelText("Weekly periods"));
      await user.type(screen.getByLabelText("Weekly periods"), "6");
      await save(user);

      await waitFor(() => {
        expect(mockUpdateAllocation).toHaveBeenCalledWith(ALLOCATION_ID, { weeklyPeriods: 6 });
      });
      const input = mockUpdateAllocation.mock.calls[0]?.[1];
      expect(input).not.toHaveProperty("effectiveFrom");
      expect(input).not.toHaveProperty("effectiveTo");
    });

    it("sends nothing, and just closes, when nothing was changed", async () => {
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      const { onOpenChange, user } = renderEdit(
        allocationRecord({ weekly_periods: 5, effective_from: "2026-09-01" }),
      );

      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockUpdateAllocation).not.toHaveBeenCalled();
      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("sends nothing when a change is undone before saving", async () => {
      const { onOpenChange, user } = renderEdit(allocationRecord({ weekly_periods: 5 }));

      await user.click(screen.getByRole("switch", { name: "Primary teacher" }));
      await user.click(screen.getByRole("switch", { name: "Primary teacher" }));
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockUpdateAllocation).not.toHaveBeenCalled();
    });

    it("sends null when the weekly periods are cleared, to drop the override", async () => {
      const { user } = renderEdit(allocationRecord({ weekly_periods: 5 }));

      await user.clear(screen.getByLabelText("Weekly periods"));
      await save(user);

      await waitFor(() => {
        expect(mockUpdateAllocation).toHaveBeenCalledWith(ALLOCATION_ID, { weeklyPeriods: null });
      });
    });

    it("sends null when the start date is cleared", async () => {
      const { user } = renderEdit(allocationRecord({ effective_from: "2026-09-01" }));

      fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "" } });
      await save(user);

      await waitFor(() => {
        expect(mockUpdateAllocation).toHaveBeenCalledWith(ALLOCATION_ID, { effectiveFrom: null });
      });
    });

    it("asks for a whole number of periods when the override is 0", async () => {
      const { user } = renderEdit();

      await typePeriods(user, "0");
      await save(user);

      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();
      expect(screen.getByLabelText("Weekly periods")).toHaveAttribute("aria-invalid", "true");
      expect(mockUpdateAllocation).not.toHaveBeenCalled();
    });

    it("refreshes everything under teacher-allocations once it is saved", async () => {
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      const { onOpenChange, user } = renderEdit();

      await typePeriods(user, "7");
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["teacher-allocations"] });
    });

    it("warns when the edit leaves the teacher over the norm, and the save still stands", async () => {
      mockUpdateAllocation.mockResolvedValue(savedAllocation([overNormWarning()]));
      const { onOpenChange, user } = renderEdit();

      await typePeriods(user, "12");
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockToastSuccess).toHaveBeenCalledWith("Allocation saved.");
      expect(mockToastWarning).toHaveBeenCalledWith(
        "This teacher is now allocated 34 periods a week, above the norm of 30. The allocation was saved.",
      );
    });
  });

  describe("when the server refuses", () => {
    it("shows a 422 on weekly_periods under that field and stays open", async () => {
      const issue = "Weekly periods can't be more than the day allows.";
      mockUpdateAllocation.mockRejectedValue(
        apiError(422, "domain_rule_violation", "weekly_periods", issue),
      );
      const { onOpenChange, user } = renderEdit();

      await typePeriods(user, "70");
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.getByLabelText("Weekly periods")).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("shows an error naming a field it doesn't edit as the form's own message", async () => {
      const issue = "Teacher 'Ayesha Khan' is no longer active.";
      mockUpdateAllocation.mockRejectedValue(
        apiError(422, "domain_rule_violation", "staff_id", issue),
      );
      const { onOpenChange, user } = renderEdit();

      await typePeriods(user, "7");
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("shows a locked session's refusal as the form's own message", async () => {
      const issue = "Academic session '2025-26' is closed and cannot be modified.";
      mockUpdateAllocation.mockRejectedValue(
        apiError(422, "domain_rule_violation", "non_field", issue),
      );
      const { user } = renderEdit();

      await typePeriods(user, "7");
      await save(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
    });

    it("drops the form's message when the next attempt is made", async () => {
      const issue = "Another allocation already holds the primary slot.";
      mockUpdateAllocation
        .mockRejectedValueOnce(apiError(409, "conflict", "non_field", issue))
        .mockResolvedValue(savedAllocation());
      const { onOpenChange, user } = renderEdit();

      await typePeriods(user, "7");
      await save(user);
      expect(await screen.findByText(issue)).toBeInTheDocument();
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockUpdateAllocation).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(issue)).not.toBeInTheDocument();
    });

    it("falls back to a generic message for a failure that isn't an API error", async () => {
      mockUpdateAllocation.mockRejectedValue(new TypeError("Failed to fetch"));
      const { user } = renderEdit();

      await typePeriods(user, "7");
      await save(user);

      const message = await screen.findByText("Something went wrong. Please try again.");
      expect(message).toBeInTheDocument();
    });
  });

  it("closes without saving on Cancel", async () => {
    const { onOpenChange, user } = renderEdit();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockUpdateAllocation).not.toHaveBeenCalled();
  });
});
