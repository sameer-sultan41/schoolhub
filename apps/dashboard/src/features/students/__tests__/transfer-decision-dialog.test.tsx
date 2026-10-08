import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { TransferDecisionDialog } from "../transfer-decision-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    studentTransfers: { approveTransfer: jest.fn(), rejectTransfer: jest.fn() },
  },
}));

const mockApproveTransfer = Services.studentTransfers.approveTransfer as jest.MockedFunction<
  typeof Services.studentTransfers.approveTransfer
>;
const mockRejectTransfer = Services.studentTransfers.rejectTransfer as jest.MockedFunction<
  typeof Services.studentTransfers.rejectTransfer
>;

describe("TransferDecisionDialog", () => {
  beforeEach(() => {
    mockApproveTransfer.mockReset();
    mockRejectTransfer.mockReset();
  });

  it("renders via ResponsiveAlertDialog", () => {
    renderWithProviders(
      <TransferDecisionDialog
        transferId="t1"
        studentId="s1"
        decision="approve"
        open
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("calls approveTransfer with a fresh idempotency key when decision is approve", async () => {
    mockApproveTransfer.mockResolvedValue({ id: "t1" } as never);
    renderWithProviders(
      <TransferDecisionDialog
        transferId="t1"
        studentId="s1"
        decision="approve"
        open
        onOpenChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mockApproveTransfer).toHaveBeenCalledWith("t1", expect.any(String));
    });
  });

  it("calls rejectTransfer with a fresh idempotency key when decision is reject", async () => {
    mockRejectTransfer.mockResolvedValue({ id: "t1" } as never);
    renderWithProviders(
      <TransferDecisionDialog
        transferId="t1"
        studentId="s1"
        decision="reject"
        open
        onOpenChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mockRejectTransfer).toHaveBeenCalledWith("t1", expect.any(String));
    });
  });

  it("maps a segregation-of-duties 422 onto the dialog's error, without closing", async () => {
    const onOpenChange = jest.fn();
    mockApproveTransfer.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "You cannot approve your own request.",
        url: "/student-transfers/t1:approve",
        details: [{ field: "non_field", issue: "You cannot approve your own request." }],
        requestId: "req-1",
      }),
    );
    renderWithProviders(
      <TransferDecisionDialog
        transferId="t1"
        studentId="s1"
        decision="approve"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("You cannot approve your own request.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
