import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
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

import { ReinstateAllocationDialog } from "../reinstate-allocation-dialog";

// Reinstating surfaces as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { teacherAllocations: { reinstateAllocation: jest.fn() } },
}));

const mockReinstateAllocation = Services.teacherAllocations
  .reinstateAllocation as jest.MockedFunction<
  typeof Services.teacherAllocations.reinstateAllocation
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastWarning = toast.warning as jest.MockedFunction<typeof toast.warning>;

function renderReinstate() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <ReinstateAllocationDialog
      open
      onOpenChange={onOpenChange}
      record={allocationRecord({ effective_to: "2026-09-30" })}
    />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

function refusal(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: `/teacher-subject-allocations/${ALLOCATION_ID}`,
    details: [{ field, issue }],
  });
}

describe("ReinstateAllocationDialog", () => {
  beforeEach(() => {
    mockReinstateAllocation.mockReset().mockResolvedValue(savedAllocation());
    mockToastSuccess.mockReset();
    mockToastWarning.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says a reinstated primary replaces the section's current primary teacher", () => {
    renderReinstate();

    const dialog = screen.getByRole("alertdialog", { name: "Reinstate this allocation" });
    expect(dialog).toHaveTextContent(
      "it replaces the section's current primary teacher for this subject",
    );
  });

  it("reinstates the allocation, refreshes the list, toasts and closes", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const { onOpenChange, user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockReinstateAllocation).toHaveBeenCalledWith(ALLOCATION_ID);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["teacher-allocations"] });
    expect(mockToastSuccess).toHaveBeenCalledWith("Allocation reinstated.");
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it("warns when the reinstated load leaves the teacher over the norm", async () => {
    mockReinstateAllocation.mockResolvedValue(savedAllocation([overNormWarning()]));
    const { onOpenChange, user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockToastWarning).toHaveBeenCalledWith(
      "This teacher is now allocated 34 periods a week, above the norm of 30. The allocation was saved.",
    );
  });

  it("shows a refusal inline and stays open", async () => {
    const issue = "Academic session '2025-26' is closed and cannot be modified.";
    mockReinstateAllocation.mockRejectedValue(refusal("non_field", issue));
    const { onOpenChange, user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(
      screen.getByRole("alertdialog", { name: "Reinstate this allocation" }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows a refusal that names a field inline, as the dialog has no inputs", async () => {
    const issue = "The subject is no longer in the class's curriculum.";
    mockReinstateAllocation.mockRejectedValue(refusal("subject_id", issue));
    const { user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
  });

  it("falls back to a generic message for a failure that isn't an API error", async () => {
    mockReinstateAllocation.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    const message = await screen.findByText("Something went wrong. Please try again.");
    expect(message).toBeInTheDocument();
  });

  it("closes without reinstating on Cancel", async () => {
    const { onOpenChange, user } = renderReinstate();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockReinstateAllocation).not.toHaveBeenCalled();
  });
});
