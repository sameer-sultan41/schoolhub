import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  ALLOCATION_ID,
  allocationRecord,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { renderWithProviders } from "@/test-utils";

import { DeleteAllocationDialog } from "../delete-allocation-dialog";

// Removing surfaces as a toast, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { teacherAllocations: { deleteAllocation: jest.fn() } },
}));

const mockDeleteAllocation = Services.teacherAllocations.deleteAllocation as jest.MockedFunction<
  typeof Services.teacherAllocations.deleteAllocation
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

function renderDelete() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <DeleteAllocationDialog open onOpenChange={onOpenChange} record={allocationRecord()} />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

/** A 422 refusal, as the API words them: `field` is `non_field` or the field it names. */
function refusal(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: `/teacher-subject-allocations/${ALLOCATION_ID}`,
    details: [{ field, issue }],
  });
}

describe("DeleteAllocationDialog", () => {
  beforeEach(() => {
    mockDeleteAllocation.mockReset().mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says it is for an allocation entered by mistake", () => {
    renderDelete();

    const dialog = screen.getByRole("alertdialog", { name: "Remove this allocation" });
    expect(dialog).toHaveTextContent("Use this only for an allocation entered by mistake.");
  });

  it("removes the allocation, refreshes the list, toasts and closes", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockDeleteAllocation).toHaveBeenCalledWith(ALLOCATION_ID);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["teacher-allocations"] });
    expect(mockToastSuccess).toHaveBeenCalledWith("Allocation removed.");
  });

  it("shows a 422 inline and stays open", async () => {
    const issue = "Academic session '2025-26' is closed and cannot be modified.";
    mockDeleteAllocation.mockRejectedValue(refusal("non_field", issue));
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Remove this allocation" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows a refusal that names a field inline, as the dialog has no inputs", async () => {
    const issue = "This allocation has a timetable slot and cannot be removed.";
    mockDeleteAllocation.mockRejectedValue(refusal("section_id", issue));
    const { user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
  });

  it("clears the refusal when it is tried again, and closes once it succeeds", async () => {
    const issue = "This allocation has a timetable slot and cannot be removed.";
    mockDeleteAllocation.mockRejectedValueOnce(refusal("non_field", issue));
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(issue)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText(issue)).not.toBeInTheDocument();
    expect(mockDeleteAllocation).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic message for a failure that isn't an API error", async () => {
    mockDeleteAllocation.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    const message = await screen.findByText("Something went wrong. Please try again.");
    expect(message).toBeInTheDocument();
  });

  it("closes without removing on Cancel", async () => {
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockDeleteAllocation).not.toHaveBeenCalled();
  });
});
