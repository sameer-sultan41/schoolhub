import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import type * as HelpersModule from "@/lib/helpers";
import { Services } from "@/services";
import {
  ALLOCATION_ID,
  allocationRecord,
  savedAllocation,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import { renderWithProviders } from "@/test-utils";

import { EndAllocationDialog } from "../end-allocation-dialog";

// Ending surfaces as a toast, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// A fixed "today", so the assertion is on what the dialog sends, not on the clock. That it is
// the UTC date is `todayIsoDate`'s own test (`lib/__tests__/helpers.test.ts`).
const mockToday = "2026-10-14";
jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  todayIsoDate: () => mockToday,
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { teacherAllocations: { endAllocation: jest.fn() } },
}));

const mockEndAllocation = Services.teacherAllocations.endAllocation as jest.MockedFunction<
  typeof Services.teacherAllocations.endAllocation
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

function renderEnd() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <EndAllocationDialog open onOpenChange={onOpenChange} record={allocationRecord()} />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

/** A refusal, as the API words them: `field` is `non_field` or the field it names. */
function refusal(status: number, code: string, field: string, issue: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: `/teacher-subject-allocations/${ALLOCATION_ID}`,
    details: [{ field, issue }],
  });
}

describe("EndAllocationDialog", () => {
  beforeEach(() => {
    mockEndAllocation.mockReset().mockResolvedValue(savedAllocation());
    mockToastSuccess.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says it ends today and keeps the history", () => {
    renderEnd();

    const dialog = screen.getByRole("alertdialog", { name: "End this allocation" });
    expect(dialog).toHaveTextContent("The allocation ends today and stays in the history.");
  });

  it("ends the allocation today, refreshes the list, toasts and closes", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const { onOpenChange, user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "End" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockEndAllocation).toHaveBeenCalledWith(ALLOCATION_ID, mockToday);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["teacher-allocations"] });
    expect(mockToastSuccess).toHaveBeenCalledWith("Allocation ended.");
  });

  it("shows a 400 inline, stays open and does not toast", async () => {
    const issue = "The end date can't be in the future.";
    mockEndAllocation.mockRejectedValue(refusal(400, "validation_error", "effective_to", issue));
    const { onOpenChange, user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "End" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "End this allocation" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows a refusal that names no field (a locked session) inline", async () => {
    const issue = "Academic session '2025-26' is closed and cannot be modified.";
    mockEndAllocation.mockRejectedValue(refusal(422, "domain_rule_violation", "non_field", issue));
    const { user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "End" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
  });

  it("clears the refusal when it is tried again, and closes once it succeeds", async () => {
    const issue = "The end date can't be in the future.";
    mockEndAllocation.mockRejectedValueOnce(
      refusal(400, "validation_error", "effective_to", issue),
    );
    const { onOpenChange, user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "End" }));
    expect(await screen.findByText(issue)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "End" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText(issue)).not.toBeInTheDocument();
    expect(mockEndAllocation).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic message for a failure that isn't an API error", async () => {
    mockEndAllocation.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "End" }));

    const message = await screen.findByText("Something went wrong. Please try again.");
    expect(message).toBeInTheDocument();
  });

  it("closes without ending on Cancel", async () => {
    const { onOpenChange, user } = renderEnd();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockEndAllocation).not.toHaveBeenCalled();
  });
});
