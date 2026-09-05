import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionDecisionRecord } from "@/features/academics/academics-types";
import { PromotionDecisionForm } from "@/features/academics/promotion-decision-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { patch: jest.fn() } }));

/** The class and section lists, in mutable bindings so one test can hold them in
 * the `data: undefined` state the dialog paints before they arrive. */
interface Option {
  id: string;
  name: string;
  class_id?: string;
}
const CLASSES: Option[] = [
  { id: "class8", name: "Grade 8" },
  { id: "class9", name: "Grade 9" },
];
const SECTIONS: Option[] = [{ id: "sec9a", name: "A", class_id: "class9" }];
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };
let mockSections: { data: Option[] | undefined } = { data: SECTIONS };

jest.mock("@/features/students/use-reference-data", () => ({
  useClasses: () => mockClasses,
  useSectionsForClass: () => mockSections,
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

/** A row a reviewer has already worked on: target section chosen, and the
 * override the API demands whenever the decision differs from the proposal. */
const OVERRIDDEN: PromotionDecisionRecord = {
  ...DECISION,
  to_section_id: "sec9a",
  decision: "promoted_on_trial",
  override_reason: "Head of year overrode the proposed retention.",
  remarks: "Review again after the first term.",
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
    mockClasses = { data: CLASSES };
    mockSections = { data: SECTIONS };
  });

  it("patches the decision by batch and student, nulling the blank optional fields", async () => {
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
      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/batch-1/decisions/stu-1", {
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
      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/batch-1/decisions/stu-1", {
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
        url: "/student-promotions/batch-1/decisions/stu-1",
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
        url: "/student-promotions/batch-1/decisions/stu-1",
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
        url: "/student-promotions/batch-1/decisions/stu-1",
        requestId: "req-4",
      }),
    );

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-4/)).toBeInTheDocument();
  });

  it("prefills the section, override reason and remarks the row already carries, and resends them", async () => {
    mockPatch.mockResolvedValue({
      data: OVERRIDDEN,
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const { user, dialog } = await open(OVERRIDDEN);
    expect(within(dialog).getByRole("combobox", { name: "Target section" })).toHaveTextContent("A");
    expect(within(dialog).getByLabelText("Override reason")).toHaveValue(
      "Head of year overrode the proposed retention.",
    );
    expect(within(dialog).getByLabelText("Remarks")).toHaveValue(
      "Review again after the first term.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/student-promotions/batch-1/decisions/stu-1", {
        decision: "promoted_on_trial",
        to_class_id: "class9",
        to_section_id: "sec9a",
        override_reason: "Head of year overrode the proposed retention.",
        remarks: "Review again after the first term.",
      });
    });
  });

  it("restores the row's own decision when a dismissed dialog is reopened", async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("combobox", { name: "Decision" }));
    await user.click(await screen.findByRole("option", { name: "Retained" }));
    expect(within(dialog).getByRole("combobox", { name: "Decision" })).toHaveTextContent(
      "Retained",
    );

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByRole("combobox", { name: "Decision" })).toHaveTextContent(
      "Promoted",
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("offers no classes to promote into while the class list is still loading", async () => {
    mockClasses = { data: undefined };
    mockSections = { data: undefined };

    const { user, dialog } = await open();
    expect(within(dialog).getByRole("combobox", { name: "Target section" })).toHaveTextContent(
      "Select a section",
    );

    await user.click(within(dialog).getByRole("combobox", { name: "Target class" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows no message at all when the client rejects with something that is not an ApiError", async () => {
    mockPatch.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
    });
    // The API envelope is the only thing this form renders, so a non-ApiError
    // rejection leaves the dialog open and unannotated.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
