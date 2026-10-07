import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { CompleteTransferDialog } from "../complete-transfer-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    schoolOrganization: { fetchSections: jest.fn() },
    studentTransfers: { completeTransfer: jest.fn() },
  },
}));

const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockCompleteTransfer = Services.studentTransfers.completeTransfer as jest.MockedFunction<
  typeof Services.studentTransfers.completeTransfer
>;

function makeInterCampusTransfer() {
  return {
    id: "t1",
    student_id: "student-1",
    transfer_type: "inter_campus" as const,
    from_campus_id: "campus-1",
    to_campus_id: "campus-2",
    external_school_name: null,
    reason: "Relocation",
    status: "approved" as const,
    effective_date: "2026-11-01",
    decided_by: "user-1",
    decided_at: "2026-10-05T00:00:00Z",
    certificate_document_id: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-05T00:00:00Z",
  };
}

function makeOutgoingTransfer() {
  return { ...makeInterCampusTransfer(), transfer_type: "outgoing" as const, to_campus_id: null };
}

describe("CompleteTransferDialog", () => {
  beforeEach(() => {
    mockFetchSections.mockReset();
    mockCompleteTransfer.mockReset();
    mockFetchSections.mockResolvedValue([{ id: "section-9", name: "C" }]);
  });

  it("inter_campus with an active enrollment: requires a section, scoped to the destination campus", async () => {
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /complete/i })).toBeDisabled();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await screen.findByRole("option", { name: "C" });
    expect(mockFetchSections).toHaveBeenCalledWith({
      classId: "class-1",
      campusId: "campus-2",
      isActive: true,
    });
  });

  it("inter_campus with an active enrollment: submits completeTransfer with the chosen section and a fresh idempotency key", async () => {
    mockCompleteTransfer.mockResolvedValue({ id: "t1" } as never);
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "C" }));
    await userEvent.click(screen.getByRole("button", { name: /complete/i }));

    await waitFor(() => {
      expect(mockCompleteTransfer).toHaveBeenCalledWith(
        "t1",
        { sectionId: "section-9" },
        expect.any(String),
      );
    });
  });

  it("inter_campus with no active enrollment: shows a plain confirm with explanatory copy and no section field", () => {
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={null}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /section/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only the campus will be updated/i)).toBeInTheDocument();
  });

  it("inter_campus with no active enrollment: submits completeTransfer with an empty payload", async () => {
    mockCompleteTransfer.mockResolvedValue({ id: "t1" } as never);
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={null}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /complete/i }));

    await waitFor(() => {
      expect(mockCompleteTransfer).toHaveBeenCalledWith("t1", {}, expect.any(String));
    });
  });

  it("outgoing: renders a plain confirm with no section field regardless of currentEnrollmentClass", () => {
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeOutgoingTransfer()}
        currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole("combobox", { name: /section/i })).not.toBeInTheDocument();
  });

  it("hides the dialog entirely when canComplete is false", () => {
    const { container } = renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={null}
        canComplete={false}
        open={false}
        onOpenChange={jest.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("maps a capacity-exceeded 422 to the error display with no override option anywhere", async () => {
    mockCompleteTransfer.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "Capacity exceeded.",
        url: "/student-transfers/t1:complete",
        details: [{ field: "non_field", issue: "Capacity exceeded." }],
        requestId: "req-1",
      }),
    );
    renderWithProviders(
      <CompleteTransferDialog
        transfer={makeInterCampusTransfer()}
        currentEnrollmentClass={null}
        canComplete
        open
        onOpenChange={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /complete/i }));

    expect(await screen.findByText("Capacity exceeded.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/override/i)).not.toBeInTheDocument();
  });
});
