import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";
import type { PermissionKey } from "@schoolhub/types";

import { PaymentsHome } from "@/features/fees/payments/payments-home";
import {
  approveRefund,
  asUser,
  CURRENT_USER_ID,
  cursorPage,
  listRefunds,
  PAYMENTS_VIEW_PERMISSIONS,
  processRefund,
  refundRecord,
  rejectRefund,
  ruleViolation,
  stubFeesServices,
} from "./fees-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

const APPROVER: PermissionKey[] = [...PAYMENTS_VIEW_PERMISSIONS, "fees.refund.approve"];

async function renderRefunds(
  refunds: ReturnType<typeof refundRecord>[],
  keys: PermissionKey[] = APPROVER,
) {
  stubFeesServices("/fees/payments?tab=refunds");
  asUser(...keys);
  listRefunds.mockResolvedValue(cursorPage(refunds));
  renderWithProviders(
    <>
      <UserLoaded />
      <PaymentsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  // The row is there once the list has loaded.
  await screen.findByText("Charged twice");
  return userEvent.setup();
}

const APPROVE_ROW = {
  name: "Approve the refund of 200.00 for Ayesha Khan, invoice INV-2026-0001",
} as const;
const REJECT_ROW = {
  name: "Reject the refund of 200.00 for Ayesha Khan, invoice INV-2026-0001",
} as const;
const PROCESS_ROW = {
  name: "Process the refund of 200.00 for Ayesha Khan, invoice INV-2026-0001",
} as const;

describe("payments page: refunds", () => {
  it("offers Approve and Reject on a request someone else made, and Process on an approved one", async () => {
    await renderRefunds([
      refundRecord(),
      refundRecord({ id: "r2", status: "approved", reason: "Duplicate" }),
    ]);

    // One requested row (Approve + Reject) and one approved row (Process): each only where valid.
    expect(screen.getAllByRole("button", APPROVE_ROW)).toHaveLength(1);
    expect(screen.getAllByRole("button", REJECT_ROW)).toHaveLength(1);
    expect(screen.getAllByRole("button", PROCESS_ROW)).toHaveLength(1);
  });

  it("hides Approve and Reject on a refund the viewer requested, but not Process once approved", async () => {
    await renderRefunds([
      refundRecord({ requested_by: CURRENT_USER_ID }),
      refundRecord({
        id: "r2",
        status: "approved",
        reason: "Duplicate",
        requested_by: CURRENT_USER_ID,
      }),
    ]);

    expect(screen.queryByRole("button", APPROVE_ROW)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", REJECT_ROW)).not.toBeInTheDocument();
    expect(screen.getByRole("button", PROCESS_ROW)).toBeInTheDocument();
  });

  it.each([["rejected"], ["processed"]] as const)(
    "offers no action on a %s refund",
    async (status) => {
      await renderRefunds([refundRecord({ status })]);

      expect(screen.queryByRole("button", APPROVE_ROW)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", REJECT_ROW)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", PROCESS_ROW)).not.toBeInTheDocument();
    },
  );

  it("offers nothing without fees.refund.approve", async () => {
    await renderRefunds(
      [refundRecord(), refundRecord({ id: "r2", status: "approved", reason: "Duplicate" })],
      PAYMENTS_VIEW_PERMISSIONS,
    );

    expect(screen.queryByRole("button", APPROVE_ROW)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", REJECT_ROW)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", PROCESS_ROW)).not.toBeInTheDocument();
  });

  it("approves with an optional note and reloads the list", async () => {
    approveRefund.mockResolvedValue(refundRecord({ status: "approved" }));
    const user = await renderRefunds([refundRecord()]);
    const reads = listRefunds.mock.calls.length;

    await user.click(screen.getByRole("button", APPROVE_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Approve refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(approveRefund).toHaveBeenCalledWith("a2222222-2222-4222-8222-222222222222", {
        note: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listRefunds.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("shows the server's self-approval refusal inline, and keeps the dialog open", async () => {
    approveRefund.mockRejectedValue(
      ruleViolation(
        "approved_by",
        "The person who requested a refund cannot approve it (auth-and-rbac §2.4).",
      ),
    );
    const user = await renderRefunds([refundRecord()]);

    await user.click(screen.getByRole("button", APPROVE_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Approve refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(
      await within(dialog).findByText(
        "The person who requested a refund cannot approve it (auth-and-rbac §2.4).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Approve refund of 200.00" })).toBeInTheDocument();
  });

  it("asks for a note on a rejection before it asks the server", async () => {
    rejectRefund.mockResolvedValue(refundRecord({ status: "rejected" }));
    const user = await renderRefunds([refundRecord()]);

    await user.click(screen.getByRole("button", REJECT_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Reject refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(rejectRefund).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Note"), "Already refunded in cash");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(rejectRefund).toHaveBeenCalledWith("a2222222-2222-4222-8222-222222222222", {
        note: "Already refunded in cash",
      });
    });
  });

  it("processes with one Idempotency-Key per dialog: a retry after a failure reuses it", async () => {
    processRefund.mockRejectedValueOnce(new Error("network down"));
    processRefund.mockResolvedValue(refundRecord({ status: "processed" }));
    const user = await renderRefunds([refundRecord({ status: "approved" })]);

    await user.click(screen.getByRole("button", PROCESS_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Process refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Process refund" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Process refund" }));

    await waitFor(() => {
      expect(processRefund).toHaveBeenCalledTimes(2);
    });
    const keys = processRefund.mock.calls.map(([, , key]) => key);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(processRefund).toHaveBeenLastCalledWith(
      "a2222222-2222-4222-8222-222222222222",
      { method: "cash", referenceNo: null },
      keys[0],
    );
  });

  it("uses a new key once the form changed, since the body is a different request", async () => {
    processRefund.mockRejectedValueOnce(new Error("network down"));
    processRefund.mockResolvedValue(refundRecord({ status: "processed" }));
    const user = await renderRefunds([refundRecord({ status: "approved" })]);

    await user.click(screen.getByRole("button", PROCESS_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Process refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Process refund" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Reference (optional)"), "BANK-1");
    await user.click(within(dialog).getByRole("button", { name: "Process refund" }));

    await waitFor(() => {
      expect(processRefund).toHaveBeenCalledTimes(2);
    });
    const keys = processRefund.mock.calls.map(([, , key]) => key);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("keeps the server's refusal inline when the refund is no longer approved", async () => {
    processRefund.mockRejectedValue(
      ruleViolation("status", "Only an approved refund can be processed."),
    );
    const user = await renderRefunds([refundRecord({ status: "approved" })]);

    await user.click(screen.getByRole("button", PROCESS_ROW));
    const dialog = await screen.findByRole("dialog", { name: "Process refund of 200.00" });
    await user.click(within(dialog).getByRole("button", { name: "Process refund" }));

    expect(
      await within(dialog).findByText("Only an approved refund can be processed."),
    ).toBeInTheDocument();
  });
});
