import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionDecisionRecord } from "@/features/academics/academics-types";
import { PromotionDecisionForm } from "@/features/academics/promotion-decision-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { patch: jest.fn() } }));
jest.mock("@/features/students/use-reference-data", () => ({
  useClasses: () => ({
    data: [
      { id: "class8", name: "Grade 8" },
      { id: "class9", name: "Grade 9" },
    ],
  }),
  useSectionsForClass: () => ({ data: [{ id: "sec9a", name: "A", class_id: "class9" }] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

const DECISION: PromotionDecisionRecord = {
  id: "dec1",
  batch_id: "batch-1",
  student_id: "stu-1",
  from_enrollment_id: "enr-1",
  from_academic_session_id: "sess1",
  to_academic_session_id: "sess2",
  from_class_id: "class8",
  to_class_id: "class9",
  to_section_id: null,
  decision: "promoted",
  decision_basis: { rule: "level+1" },
  override_reason: null,
  remarks: null,
  status: "draft",
  approved_by: null,
  approved_at: null,
  executed_at: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

async function open(record: PromotionDecisionRecord = DECISION) {
  const user = userEvent.setup();
  renderWithProviders(<PromotionDecisionForm decision={record} studentLabel="stu-1" />);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("PromotionDecisionForm", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("patches the decision row by its own id, nulling the blank optional fields", async () => {
    mockPatch.mockResolvedValue({
      data: DECISION,
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("combobox", { name: "Target section" }));
    await user.click(await screen.findByRole("option", { name: "A" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/dec1", {
        decision: "promoted",
        to_class_id: "class9",
        to_section_id: "sec9a",
        override_reason: null,
        remarks: null,
      });
    });
  });

  it("names the student it is editing", async () => {
    const { dialog } = await open();
    expect(
      within(dialog).getByText("Adjusting the draft decision for student stu-1."),
    ).toBeInTheDocument();
  });

  it("rejects a non-graduating decision left with no target class", async () => {
    const { user, dialog } = await open({ ...DECISION, to_class_id: null });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("A target class is required unless the student is graduating."),
    ).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects a graduating student that still names a target class", async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("combobox", { name: "Decision" }));
    await user.click(await screen.findByRole("option", { name: "Graduated" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("A graduating student has no target class."),
    ).toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("locks the target class and section once the decision is graduated", async () => {
    const { user, dialog } = await open({
      ...DECISION,
      decision: "graduated",
      to_class_id: null,
    });

    expect(within(dialog).getByRole("combobox", { name: "Target class" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Target section" })).toBeDisabled();

    mockPatch.mockResolvedValue({
      data: DECISION,
      meta: undefined,
      requestId: null,
      status: 200,
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/dec1", {
        decision: "graduated",
        to_class_id: null,
        to_section_id: null,
        override_reason: null,
        remarks: null,
      });
    });
  });

  it("puts a server field error on the field it names", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/student-promotions/dec1",
        details: [{ field: "override_reason", issue: "An override reason is required." }],
      }),
    );

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("An override reason is required.")).toBeInTheDocument();
  });

  it("routes a read-only field into the root message", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/student-promotions/dec1",
        details: [{ field: "status", issue: "This decision is approved." }],
      }),
    );

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This decision is approved.")).toBeInTheDocument();
  });

  it("renders the error envelope when the batch has left draft", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "This decision is approved and can no longer be edited.",
        status: 409,
        url: "/student-promotions/dec1",
        requestId: "req-4",
      }),
    );

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-4/)).toBeInTheDocument();
  });
});
