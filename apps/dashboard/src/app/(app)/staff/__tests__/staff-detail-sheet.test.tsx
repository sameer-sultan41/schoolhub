import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StaffDetailSheet } from "../staff-detail-sheet";
import type { StaffRow } from "../staff-directory-table";

jest.mock("@/services", () => ({
  Services: {
    dashboard: {
      fetchStaffById: jest.fn(),
    },
  },
}));

const mockFetchStaffById = Services.dashboard.fetchStaffById as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffById
>;

function staffRow(overrides: Partial<StaffRow> = {}): StaffRow {
  return {
    id: "st-1",
    name: "Ayesha Khan",
    designation: "Senior Teacher",
    campus: "Main Campus",
    status: "active",
    updatedAt: "2026-09-20T00:00:00Z",
    photoUrl: null,
    ...overrides,
  };
}

// Typed from fetchStaffById so the fixture tracks what it actually returns.
function staffDetail(
  overrides: Partial<Awaited<ReturnType<typeof Services.dashboard.fetchStaffById>>> = {},
) {
  return {
    id: "st-1",
    employee_number: "EMP-0231",
    first_name: "Ayesha",
    last_name: "Khan",
    gender: "female",
    date_of_birth: "1990-04-29",
    photo_file_id: null,
    photo_url: null,
    staff_type: "teaching" as const,
    campus_id: "c-1",
    department_id: null,
    designation_id: null,
    reports_to_staff_id: null,
    employment_type: "full_time",
    employment_status: "active",
    joining_date: "2022-01-01",
    email: "ayesha@example.com",
    phone: "+92-300-1234567",
    national_id: "42101-1234567-1",
    public_bio: null,
    address: null,
    ...overrides,
  };
}

describe("StaffDetailSheet", () => {
  beforeEach(() => {
    mockFetchStaffById.mockReset();
  });

  it("renders nothing when no row is selected", () => {
    renderWithProviders(
      <StaffDetailSheet
        row={null}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.queryByText("Ayesha Khan")).not.toBeInTheDocument();
  });

  it("shows the row's own summary fields immediately, with skeletons for the fetched ones", () => {
    // Never resolves, so the fetched fields stay as skeletons.
    mockFetchStaffById.mockReturnValue(new Promise(() => {}));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("Senior Teacher · Main Campus")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Last updated", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("EMP-0231")).not.toBeInTheDocument();
  });

  it("shows every fetched field once the query resolves", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail());

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(await screen.findByText("EMP-0231")).toBeInTheDocument();
    expect(screen.getByText("ayesha@example.com")).toBeInTheDocument();
    expect(screen.getByText("+92-300-1234567")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
    expect(screen.getByText("Full time")).toBeInTheDocument();
    expect(screen.getByText("42101-1234567-1")).toBeInTheDocument();
    // date-fns "PPP" format for 2022-01-01.
    expect(screen.getByText("January 1st, 2022")).toBeInTheDocument();
  });

  it('shows "—" for a missing national ID or date of birth, never blank', async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail({ national_id: null, date_of_birth: null }));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await screen.findByText("EMP-0231");
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("falls back to the raw joining-date string when it isn't a parseable date", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail({ joining_date: "not-a-date" }));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(await screen.findByText("not-a-date")).toBeInTheDocument();
  });

  it("shows the bio only when the record has one", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail({ public_bio: "Loves teaching maths." }));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(await screen.findByText("Loves teaching maths.")).toBeInTheDocument();
  });

  it("no bio block renders when the record has none", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail({ public_bio: null }));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    await screen.findByText("EMP-0231");
    expect(screen.queryByText("Bio")).not.toBeInTheDocument();
  });

  it("shows an error message when the detail fetch fails", async () => {
    mockFetchStaffById.mockRejectedValue(new Error("network error"));

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(await screen.findByText("Couldn't load full details. Try again.")).toBeInTheDocument();
  });

  it("Edit calls onEdit with the row's id", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail());
    const onEdit = jest.fn();

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={onEdit}
        onDelete={jest.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledWith("st-1");
  });

  it("Exit calls onDelete with the row's id and name", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail());
    const onDelete = jest.fn();

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onDelete={onDelete}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Exit" }));

    expect(onDelete).toHaveBeenCalledWith("st-1", "Ayesha Khan");
  });

  it("closing the sheet calls onOpenChange(false)", async () => {
    mockFetchStaffById.mockResolvedValue(staffDetail());
    const onOpenChange = jest.fn();

    renderWithProviders(
      <StaffDetailSheet
        row={staffRow()}
        onOpenChange={onOpenChange}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
