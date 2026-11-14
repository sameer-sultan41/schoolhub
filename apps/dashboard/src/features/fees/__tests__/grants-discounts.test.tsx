import type * as ReactModule from "react";
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { pick } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { DiscountsTab } from "@/features/fees/grants/discounts-tab";
import { asUser, cursorPage, rowOf, ruleViolation, SESSION_ID } from "./fees-test-support";
import {
  createDiscount,
  DISCOUNT_ID,
  discountRecord,
  GRANTS_PERMISSIONS,
  listDiscounts,
  revokeDiscount,
  stubGrantsServices,
} from "./grants-test-support";

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

// The picker searches the students list; a stand-in that picks one student keeps this file on the form.
jest.mock("@/components/student-picker", () => {
  const react = jest.requireActual<typeof ReactModule>("react");
  return {
    StudentPicker: ({ onChange }: { onChange: (value: { id: string; name: string }) => void }) =>
      react.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            onChange({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Ayesha Khan" });
          },
        },
        "Choose a student",
      ),
  };
});

const SECOND_ID = "d0000000-0000-4000-8000-000000000011";

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <DiscountsTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("discounts tab", () => {
  beforeEach(() => {
    stubGrantsServices();
  });

  it("shows each discount with its value, head and status as the server sent them", async () => {
    listDiscounts.mockResolvedValue(
      cursorPage([
        discountRecord(),
        discountRecord({
          id: SECOND_ID,
          name: "Staff ward",
          discount_type: "fixed",
          value: "1500.5",
          fee_head: "77777777-7777-4777-8777-777777777777",
          status: "revoked",
        }),
      ]),
    );
    asUser("fees.discount.view", "fees.fee-structure.view", "school.academic-session.view");
    await renderTab();

    await screen.findByText("Staff ward");
    const first = rowOf("Sibling discount");
    expect(first.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(first.getByText("10%")).toBeInTheDocument();
    expect(first.getByText("Every head")).toBeInTheDocument();
    expect(await first.findByText("2026-27")).toBeInTheDocument();
    expect(first.getByText("Active")).toBeInTheDocument();
    const second = rowOf("Staff ward");
    expect(second.getByText("1,500.50")).toBeInTheDocument();
    expect(await second.findByText("Library fee")).toBeInTheDocument();
    expect(second.getByText("Revoked")).toBeInTheDocument();
  });

  it("offers Revoke only on an active discount, and only to a holder of the waive key", async () => {
    listDiscounts.mockResolvedValue(
      cursorPage([
        discountRecord(),
        discountRecord({ id: SECOND_ID, name: "Old discount", status: "revoked" }),
        discountRecord({
          id: "d0000000-0000-4000-8000-000000000012",
          name: "Lapsed",
          status: "expired",
        }),
      ]),
    );
    asUser("fees.discount.view", "fees.discount.waive");
    await renderTab();

    await screen.findByText("Old discount");
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(1);
    expect(
      rowOf("Sibling discount").getByRole("button", { name: "Revoke Sibling discount" }),
    ).toBeInTheDocument();
  });

  it("hides Revoke and Grant from a viewer holding only the view key", async () => {
    asUser("fees.discount.view");
    await renderTab();

    await screen.findByText("Sibling discount");
    expect(screen.queryByRole("button", { name: /^Revoke / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grant discount" })).not.toBeInTheDocument();
  });

  it("hides Grant from a creator who cannot read the students or sessions its pickers need", async () => {
    asUser("fees.discount.view", "fees.discount.create");
    await renderTab();

    await screen.findByText("Sibling discount");
    expect(screen.queryByRole("button", { name: "Grant discount" })).not.toBeInTheDocument();
  });

  it("revokes with the reason typed", async () => {
    revokeDiscount.mockResolvedValue(discountRecord({ status: "revoked" }));
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Revoke Sibling discount" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Sibling discount" });
    await user.type(within(dialog).getByLabelText("Reason"), "Sibling left");
    await user.click(within(dialog).getByRole("button", { name: "Revoke discount" }));

    await waitFor(() => {
      expect(revokeDiscount).toHaveBeenCalledWith(DISCOUNT_ID, "Sibling left");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("requires a reason before it asks the server", async () => {
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Revoke Sibling discount" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Sibling discount" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke discount" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(revokeDiscount).not.toHaveBeenCalled();
  });

  it("shows the refusal inline, and keeps the dialog open, when the discount is gone", async () => {
    // The dialog trims and requires the reason, so what the endpoint can still send is a 404.
    revokeDiscount.mockRejectedValue(
      new ApiError({ status: 404, code: "not_found", message: "Not found.", url: "/discounts" }),
    );
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Revoke Sibling discount" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke Sibling discount" });
    await user.type(within(dialog).getByLabelText("Reason"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Revoke discount" }));

    expect(
      await within(dialog).findByText("We could not find what you were looking for."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Revoke Sibling discount" })).toBeInTheDocument();
  });

  async function openGrantDialog() {
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();
    await user.click(await screen.findByRole("button", { name: "Grant discount" }));
    const dialog = await screen.findByRole("dialog", { name: "Grant a discount" });
    return { user, dialog };
  }

  it("grants a discount to the picked student and session", async () => {
    createDiscount.mockResolvedValue(discountRecord());
    const { user, dialog } = await openGrantDialog();

    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await pick(user, "Session", "2026-27");
    await user.type(within(dialog).getByLabelText("Name"), "Sibling discount");
    await user.type(within(dialog).getByLabelText("Value"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createDiscount).toHaveBeenCalledWith({
        studentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        academicSessionId: SESSION_ID,
        name: "Sibling discount",
        discountType: "percent",
        value: "10",
        feeHeadId: null,
        validFrom: null,
        validTo: null,
        reason: null,
      });
    });
  });

  it("refuses a percent over 100 before it asks the server", async () => {
    const { user, dialog } = await openGrantDialog();

    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await pick(user, "Session", "2026-27");
    await user.type(within(dialog).getByLabelText("Name"), "Too generous");
    await user.type(within(dialog).getByLabelText("Value"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Enter a positive value (a percent cannot exceed 100)."),
    ).toBeInTheDocument();
    expect(createDiscount).not.toHaveBeenCalled();
  });

  it("shows the server's refusal under the field it names", async () => {
    createDiscount.mockRejectedValue(
      ruleViolation("value", "A grant must have a positive value.", 400),
    );
    const { user, dialog } = await openGrantDialog();

    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await pick(user, "Session", "2026-27");
    await user.type(within(dialog).getByLabelText("Name"), "Sibling discount");
    await user.type(within(dialog).getByLabelText("Value"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("A grant must have a positive value."),
    ).toBeInTheDocument();
  });
});
