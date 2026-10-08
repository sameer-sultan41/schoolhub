import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { RequestTransferDialog } from "../request-transfer-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    dashboard: { fetchCampuses: jest.fn() },
    studentTransfers: { requestTransfer: jest.fn() },
  },
}));

const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockRequestTransfer = Services.studentTransfers.requestTransfer as jest.MockedFunction<
  typeof Services.studentTransfers.requestTransfer
>;

function baseProps() {
  return {
    studentId: "student-1",
    currentCampusId: "campus-1",
    open: true,
    onOpenChange: jest.fn(),
  };
}

describe("RequestTransferDialog", () => {
  beforeEach(() => {
    mockFetchCampuses.mockReset();
    mockRequestTransfer.mockReset();
    mockFetchCampuses.mockResolvedValue([
      { id: "campus-1", name: "Campus One" },
      { id: "campus-2", name: "Campus Two" },
    ]);
  });

  it("offers only inter_campus and outgoing as transfer-type options", () => {
    renderWithProviders(<RequestTransferDialog {...baseProps()} />);

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(2);
  });

  it("renders from_campus_id as a read-only label matching the student's current campus", async () => {
    renderWithProviders(<RequestTransferDialog {...baseProps()} />);

    expect(await screen.findByText("Campus One")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /from campus/i })).not.toBeInTheDocument();
  });

  it("excludes the current campus from the to_campus_id picker's options", async () => {
    renderWithProviders(<RequestTransferDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /to campus/i }));

    expect(await screen.findByRole("option", { name: "Campus Two" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Campus One" })).not.toBeInTheDocument();
  });

  it("submits requestTransfer with no idempotency key for an outgoing transfer", async () => {
    mockRequestTransfer.mockResolvedValue({ id: "t1" } as never);
    renderWithProviders(<RequestTransferDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("radio", { name: /outgoing/i }));
    await userEvent.type(screen.getByLabelText(/external school name/i), "Another School");
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Relocating");
    await userEvent.type(screen.getByLabelText(/effective date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /request transfer/i }));

    await waitFor(() => {
      expect(mockRequestTransfer).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ transferType: "outgoing", externalSchoolName: "Another School" }),
      );
    });
    expect(mockRequestTransfer.mock.calls[0]).toHaveLength(2);
  });

  it("invalidates the transfers and history query keys on a successful submit", async () => {
    mockRequestTransfer.mockResolvedValue({ id: "t1" } as never);
    const onOpenChange = jest.fn();
    renderWithProviders(<RequestTransferDialog {...baseProps()} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("radio", { name: /outgoing/i }));
    await userEvent.type(screen.getByLabelText(/external school name/i), "Another School");
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Relocating");
    await userEvent.type(screen.getByLabelText(/effective date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /request transfer/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("maps a 422 non_field error onto the form message", async () => {
    mockRequestTransfer.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "Student is not active.",
        url: "/student-transfers",
        details: [{ field: "non_field", issue: "Student is not active." }],
        requestId: "req-1",
      }),
    );
    renderWithProviders(<RequestTransferDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("radio", { name: /outgoing/i }));
    await userEvent.type(screen.getByLabelText(/external school name/i), "Another School");
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Relocating");
    await userEvent.type(screen.getByLabelText(/effective date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /request transfer/i }));

    expect(await screen.findByText("Student is not active.")).toBeInTheDocument();
  });

  it("closes without submitting when Cancel is clicked", async () => {
    const onOpenChange = jest.fn();
    renderWithProviders(<RequestTransferDialog {...baseProps()} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRequestTransfer).not.toHaveBeenCalled();
  });
});
